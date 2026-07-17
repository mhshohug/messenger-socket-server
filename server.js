console.log("TEST: Signaling server running (Full Features)!");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Supabase Setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// ইউজার অথেনটিকেশন ও আইডি গ্রহণ
io.use(async (socket, next) => {
  const token = socket.handshake.query.token;
  if (!token) return next(new Error('Authentication Error'));
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return next(new Error('Invalid Token'));
  
  socket.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(userId);
  console.log(`[LOGIN] User: ${userId} connected.`);

  // ১. কলিং - ডাটাবেজে ইনসার্ট
  socket.on('call-user', async (data) => {
    console.log(`[CALLING] From: ${userId} to: ${data.targetUserId}`);
    await supabase.from('call_history').insert({
        caller_id: userId,
        receiver_id: data.targetUserId,
        status: 'CALLING',
        started_at: new Date().toISOString()
    });
    socket.to(data.targetUserId).emit('incoming-call', { callerId: userId, ...data });
  });

  // ২. রিংগিং
  socket.on('ringing', (data) => {
    socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId });
  });

  // ৩. একসেপ্ট (কানেক্টেড) - ডাটাবেজ আপডেট
  socket.on('accept-call', async (data) => {
    console.log(`[ACCEPTED] Call accepted by ${userId}`);
    await supabase.from('call_history').update({ status: 'ACCEPTED' })
        .eq('receiver_id', userId).eq('status', 'CALLING');
    socket.to(data.callerId).emit('call-accepted', { calleeId: userId, ...data });
  });

  // ৪. এন্ড কল - ডাটাবেজ আপডেট
  socket.on('end-call', async (data) => {
    console.log(`[ENDED] Call ended by ${userId}`);
    await supabase.from('call_history').update({ status: 'ENDED', ended_at: new Date().toISOString() })
            .eq('caller_id', data.targetUserId).eq('status', 'ACCEPTED');
    socket.to(data.targetUserId).emit('call-ended', { senderId: userId });
  });

  socket.on('reject-call', (data) => socket.to(data.callerId).emit('call-rejected', data));
  socket.on('ice-candidate', (data) => socket.to(data.targetUserId).emit('ice-candidate', { senderId: userId, candidate: data.candidate }));
  
  // ৫. ডিসকানেক্ট - লগআউট লগ
  socket.on('disconnect', () => {
    console.log(`[LOGOUT] User: ${userId} disconnected.`);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Signaling server running on port ${PORT}`));
