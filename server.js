console.log("TEST: Signaling server running (No DB operations)!");
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
  const userId = socket.handshake.query.userId; // সিম্পল আইডি ব্যবহার করুন
  if (!activeUsers.has(userId)) activeUsers.set(userId, new Set());
  activeUsers.get(userId).add(socket.id);
  socket.join(userId);

  // 1. কলিং (শুধুমাত্র সিগন্যাল)
  socket.on('call-user', (data) => {
    socket.to(data.targetUserId).emit('incoming-call', { callerId: userId, ...data });
  });

  // 2. রিংগিং
  socket.on('ringing', (data) => {
    socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId });
  });

  // 3. কানেক্টেড বা একসেপ্ট
  socket.on('accept-call', (data) => {
    socket.to(data.callerId).emit('call-accepted', { calleeId: userId, ...data });
  });

  // 4. এন্ড কল (যেকোনো পাশে কাটলে দুই পাশেই কাটবে)
  socket.on('end-call', (data) => {
    socket.to(data.targetUserId).emit('call-ended', { senderId: userId });
  });

  socket.on('reject-call', (data) => socket.to(data.callerId).emit('call-rejected', data));
  socket.on('ice-candidate', (data) => socket.to(data.targetUserId).emit('ice-candidate', { senderId: userId, candidate: data.candidate }));
  
  socket.on('disconnect', () => {
    const userSockets = activeUsers.get(userId);
    if (userSockets) userSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0');
