console.log("TEST: Signaling server running (Full Features)!");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] }, transports: ['websocket'] });

// কানেকশন হ্যান্ডলার - এখানে কোনো টোকেন রিজেকশন নেই, কানেকশন সবসময় হবে
io.on('connection', (socket) => {
  // অ্যাপ থেকে টোকেন বা ইউজার আইডি গ্রহণ (যাই আসুক কাজ করবে)
  const userId = socket.handshake.query.userId || "unknown_user";
  socket.userId = userId;
  socket.join(userId);
  console.log(`[LOGIN] User: ${userId} connected.`);

  // ১. কলিং ফিচার
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

  // ২. রিংগিং ফিচার
  socket.on('ringing', (data) => {
    socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId });
  });

  // ৩. কল একসেপ্ট
  socket.on('accept-call', async (data) => {
    console.log(`[ACCEPTED] Call accepted by ${userId}`);
    await supabase.from('call_history').update({ status: 'ACCEPTED' })
        .eq('receiver_id', userId).eq('status', 'CALLING');
    socket.to(data.callerId).emit('call-accepted', { calleeId: userId, ...data });
  });

  // ৪. এন্ড কল
  socket.on('end-call', async (data) => {
    console.log(`[ENDED] Call ended by ${userId}`);
    await supabase.from('call_history').update({ status: 'ENDED', ended_at: new Date().toISOString() })
            .eq('caller_id', data.targetUserId).eq('status', 'ACCEPTED');
    socket.to(data.targetUserId).emit('call-ended', { senderId: userId });
  });

  // ৫. মেসেজিং ফিচার (আগের মতোই রাখা হয়েছে)
  socket.on('send-message', (data) => {
    socket.to(data.targetUserId).emit('receive-message', data);
  });

  socket.on('reject-call', (data) => socket.to(data.callerId).emit('call-rejected', data));
  socket.on('ice-candidate', (data) => socket.to(data.targetUserId).emit('ice-candidate', { senderId: userId, candidate: data.candidate }));
  
  socket.on('disconnect', () => {
    console.log(`[LOGOUT] User: ${userId} disconnected.`);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Signaling server running on port ${PORT}`));
