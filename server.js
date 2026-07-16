console.log("TEST: Connection established successfully!");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// টেস্ট টোকন জেনারেটর
app.get('/test-token', (req, res) => {
  const userId = 'test_user_' + Date.now();
  res.json({ 
    token: `mock_${userId}`,
    userId: userId 
  });
});

// Supabase token verification helper
async function verifySupabaseToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.warn('⚠️ Server missing SUPABASE_URL or SUPABASE_ANON_KEY env variables.');
    if (token && token.startsWith('mock_')) {
      return { id: token, email: `${token}@example.com` };
    }
    return null;
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey
      }
    });

    if (!response.ok) {
      console.error(`Supabase token verification failed with status: ${response.status}`);
      return null;
    }

    const userData = await response.json();
    return userData;
  } catch (err) {
    console.error('Error verifying Supabase token:', err);
    return null;
  }
}

const activeUsers = new Map();

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication token required'));
  }

  const user = await verifySupabaseToken(token);
  if (!user) {
    return next(new Error('Invalid or expired authentication token'));
  }

  socket.userId = user.id;
  socket.userEmail = user.email || '';
  next();
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  console.log(`🔌 User connected: ${userId} (${socket.userEmail}) [Socket: ${socket.id}]`);

  if (!activeUsers.has(userId)) {
    activeUsers.set(userId, new Set());
  }
  activeUsers.get(userId).add(socket.id);
  socket.join(userId);
  io.emit('user-status-changed', { userId, status: 'online' });

  // 1. CALL USER
  socket.on('call-user', (data) => {
    const { targetUserId, offer, isVideo, callerName, callerAvatar } = data;
    console.log(`📞 [Call User] From ${userId} to ${targetUserId}`);
    console.log(`[RENDER-LOG] CALL_INITIATED: Caller [${userId}] -> Receiver [${data.targetUserId}]`);

    if (!activeUsers.has(targetUserId) || activeUsers.get(targetUserId).size === 0) {
      socket.emit('call-failed', { targetUserId, reason: 'user_offline' });
      return;
    }

    socket.to(targetUserId).emit('incoming-call', {
      callerId: userId,
      offer,
      isVideo: !!isVideo,
      callerName: callerName || 'Anonymous',
      callerAvatar: callerAvatar || null
    });
  });

  // RINGING EVENT
  socket.on('ringing', (data) => {
    console.log(`[RENDER-LOG] RINGING: Signal sent to Receiver [${data.targetUserId}]`);
    socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId });
  });

  // 2. ACCEPT CALL
  socket.on('accept-call', (data) => {
    const { callerId, answer } = data;
    console.log(`✅ [Accept Call] Callee ${userId} accepted call from ${callerId}`);
    console.log(`[RENDER-LOG] CALL_ACCEPTED: Callee [${userId}] accepted from [${data.callerId}]`);

    if (!activeUsers.has(callerId) || activeUsers.get(callerId).size === 0) {
      socket.emit('call-failed', { targetUserId: callerId, reason: 'caller_disconnected' });
      return;
    }

    socket.to(callerId).emit('call-accepted', {
      calleeId: userId,
      answer
    });
  });

  // 3. REJECT CALL
  socket.on('reject-call', (data) => {
    const { callerId, reason } = data;
    console.log(`❌ [Reject Call] Callee ${userId} rejected call from ${callerId}`);
    console.log(`[RENDER-LOG] CALL_REJECTED: Callee [${userId}] rejected from [${data.callerId}]`);

    socket.to(callerId).emit('call-rejected', {
      calleeId: userId,
      reason: reason || 'busy'
    });
  });

  // 4. ICE CANDIDATE
  socket.on('ice-candidate', (data) => {
    socket.to(data.targetUserId).emit('ice-candidate', {
      senderId: userId,
      candidate: data.candidate
    });
  });

  // 5. END CALL
  socket.on('end-call', (data) => {
    const { targetUserId } = data;
    console.log(`📴 [End Call] Call ended between ${userId} and ${targetUserId}`);
    console.log(`[RENDER-LOG] CALL_ENDED: Connection closed between [${userId}] and [${data.targetUserId}]`);

    socket.to(targetUserId).emit('call-ended', {
      senderId: userId
    });
  });

  // 6. DISCONNECT
  socket.on('disconnect', () => {
    console.log(`🔌 User disconnected: ${userId} [Socket: ${socket.id}]`);
    
    const userSockets = activeUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        activeUsers.delete(userId);
        io.emit('user-status-changed', { userId, status: 'offline' });
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});
