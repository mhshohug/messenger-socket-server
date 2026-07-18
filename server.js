require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

// --- INITIALIZATION ---

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('[Fatal] Missing required environment variables. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and FIREBASE credentials.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.get('/health', (req, res) => res.status(200).send('LoveMessenger Signaling Server is healthy!'));
app.get('/', (req, res) => res.send('LoveMessenger Signaling Server is running.'));
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Supabase Setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Firebase Admin Setup
const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
  })
});

// User mapping: userId -> socketId
const users = new Map();

// --- FCM UTILS ---

async function sendFcmNotification(targetUserId, data, senderId = null) {
  try {
    // 1. Fetch recipient profile and sender profile (if senderId provided)
    const [recipientRes, senderRes] = await Promise.all([
      supabase.from('profiles').select('fcm_token, full_name').eq('id', targetUserId).single(),
      senderId ? supabase.from('profiles').select('full_name').eq('id', senderId).single() : Promise.resolve({ data: null })
    ]);

    const profile = recipientRes.data;
    const sender = senderRes.data;

    if (recipientRes.error || !profile || !profile.fcm_token) {
      console.log(`[FCM] No token found for user ${targetUserId}`);
      return;
    }

    const senderName = sender ? sender.full_name : (data.callerName || 'Someone');

    const message = {
      token: profile.fcm_token,
      data: {
        ...data,
        callerName: senderName, // Update with real name
        timestamp: new Date().toISOString()
      },
      android: {
        priority: 'high',
        notification: {
            channelId: (data.type === 'CALL' || data.type === 'MISSED_CALL') ? 'calls_channel' : 'messages_channel'
        }
      }
    };

    // If it's a message, add notification body for system display
    if (data.type === 'MESSAGE' || data.type === 'MISSED_CALL') {
      message.notification = {
        title: data.title || 'New Message',
        body: data.body || 'You have a new message'
      };
    }

    const response = await admin.messaging().send(message);
    console.log(`[FCM] Successfully sent message to ${targetUserId}:`, response);
  } catch (error) {
    console.error(`[FCM] Error sending message to ${targetUserId}:`, error);
    if (error.code === 'messaging/registration-token-not-registered' || error.code === 'messaging/invalid-registration-token') {
      console.log(`[FCM] Removing invalid token for user ${targetUserId}`);
      await supabase
        .from('profiles')
        .update({ fcm_token: null })
        .eq('id', targetUserId);
    }
  }
}

// --- SOCKET.IO LOGIC ---

io.on('connection', (socket) => {
  const { userId } = socket.handshake.auth || socket.handshake.query;
  
  if (!userId) {
    console.log('[Socket] Connection rejected: No userId provided');
    socket.disconnect();
    return;
  }

  console.log(`[Socket] User connected: ${userId} (Socket: ${socket.id})`);
  users.set(userId, socket.id);
  
  // Broadcast status
  io.emit('user-status-changed', { userId, status: 'online' });

  // 1. New Message
  socket.on('send-message', async (data) => {
    console.log(`[Message] From ${userId} to ${data.targetUserId}`);
    
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) {
      // Realtime delivery
      io.to(targetSocketId).emit('receive-message', data);
    } else {
      // Background delivery via FCM
      const isMissedCall = (data.content || '').includes('Missed Call');
      await sendFcmNotification(data.targetUserId, {
        type: isMissedCall ? 'MISSED_CALL' : 'MESSAGE',
        title: isMissedCall ? 'Missed Call' : 'New Message',
        body: data.text || data.content || 'Tap to view',
        senderId: userId,
        chatId: data.chatId || '',
        messageId: data.id
      }, userId);
    }
  });

  // 2. Call Signaling
  socket.on('call-user', async (data) => {
    console.log(`[Call] Offer from ${userId} to ${data.targetUserId}`);
    
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', data);
    } else {
      // Send FCM for incoming call
      await sendFcmNotification(data.targetUserId, {
        type: 'CALL',
        title: 'Incoming Call',
        body: `${data.callerName || 'Someone'} is calling you...`,
        callerId: userId,
        callerName: data.callerName || 'Someone',
        callType: data.isVideo ? 'VIDEO' : 'AUDIO',
        sdp: data.offer ? data.offer.sdp : ''
      }, userId);
    }
  });

  socket.on('accept-call', (data) => {
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) io.to(targetSocketId).emit('call-accepted', data);
  });

  socket.on('reject-call', async (data) => {
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) io.to(targetSocketId).emit('call-rejected', data);
  });

  socket.on('end-call', (data) => {
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) io.to(targetSocketId).emit('call-ended', data);
  });

  socket.on('ice-candidate', (data) => {
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) io.to(targetSocketId).emit('ice-candidate', data);
  });

  socket.on('ringing', (data) => {
    const targetSocketId = users.get(data.targetUserId);
    if (targetSocketId) io.to(targetSocketId).emit('ringing', data);
  });

  // 3. Status
  socket.on('ping', () => socket.emit('pong'));

  socket.on('disconnect', () => {
    console.log(`[Socket] User disconnected: ${userId}`);
    if (users.get(userId) === socket.id) {
      users.delete(userId);
      io.emit('user-status-changed', { userId, status: 'offline' });
    }
  });
});

// --- SERVER START ---

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LoveMessenger Signaling Server running on port ${PORT}`);
});
