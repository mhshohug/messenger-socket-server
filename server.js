console.log("TEST: Signaling server running with Full Activity Monitoring!");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const activeUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.handshake.query.userId || "unknown_user";
  
  if (!activeUsers.has(userId)) activeUsers.set(userId, new Set());
  activeUsers.get(userId).add(socket.id);
  socket.join(userId);

  // লগইন লগ
  console.log(`[LOGIN] User: ${userId} connected with Socket: ${socket.id}`);

  // 1. কলিং
  socket.on('call-user', (data) => {
    console.log(`[CALLING] From: ${userId} to: ${data.targetUserId}`);
    socket.to(data.targetUserId).emit('incoming-call', { callerId: userId, ...data });
  });

  // 2. রিংগিং
  socket.on('ringing', (data) => {
    console.log(`[RINGING] ${userId} calling ${data.targetUserId}`);
    socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId });
  });

  // 3. কানেক্টেড বা একসেপ্ট
  socket.on('accept-call', (data) => {
    console.log(`[CONNECTED] Call accepted by ${userId} for ${data.callerId}`);
    socket.to(data.callerId).emit('call-accepted', { calleeId: userId, ...data });
  });

  // 4. এন্ড কল
  socket.on('end-call', (data) => {
    console.log(`[ENDED] Call ended between ${userId} and ${data.targetUserId}`);
    socket.to(data.targetUserId).emit('call-ended', { senderId: userId });
  });

  socket.on('reject-call', (data) => {
    console.log(`[REJECTED] Call rejected by ${userId}`);
    socket.to(data.callerId).emit('call-rejected', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetUserId).emit('ice-candidate', { senderId: userId, candidate: data.candidate });
  });
  
  socket.on('disconnect', () => {
    const userSockets = activeUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      console.log(`[LOGOUT] User: ${userId} disconnected. Remaining sockets: ${userSockets.size}`);
      if (userSockets.size === 0) activeUsers.delete(userId);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server listening on port ${PORT}`));
