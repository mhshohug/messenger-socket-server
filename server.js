console.log("TEST: Connection established successfully!");
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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

async function verifySupabaseToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return token.startsWith('mock_') ? { id: token, email: `${token}@example.com` } : null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey }
    });
    return response.ok ? await response.json() : null;
  } catch (err) { return null; }
}

const activeUsers = new Map();

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Authentication token required'));
  const user = await verifySupabaseToken(token);
  if (!user) return next(new Error('Invalid or expired authentication token'));
  socket.userId = user.id;
  socket.userEmail = user.email || '';
  next();
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  if (!activeUsers.has(userId)) activeUsers.set(userId, new Set());
  activeUsers.get(userId).add(socket.id);
  socket.join(userId);

  socket.on('call-user', async (data) => {
    const { targetUserId } = data;
    console.log(`📞 [Call User] From ${userId} to ${targetUserId}`);
    
    // মডিফাইড ইনসার্ট লজিক
    try {
        const { error } = await supabase
            .from('call_history')
            .insert([
                {
                    caller_id: userId,
                    receiver_id: targetUserId,
                    status: 'CALLING',
                    started_at: new Date().toISOString()
                }
            ]);

        if (error) {
            console.error("Supabase Insert Error:", error);
        } else {
            console.log("Successfully saved call history to Supabase");
        }
    } catch (e) {
        console.error("Fatal History Insert Error:", e);
    }

    if (!activeUsers.has(targetUserId)) {
      socket.emit('call-failed', { targetUserId, reason: 'user_offline' });
      return;
    }
    socket.to(targetUserId).emit('incoming-call', data);
  });

  socket.on('ringing', (data) => socket.to(data.targetUserId).emit('incoming-ringing', { callerId: userId }));

  socket.on('accept-call', (data) => {
    socket.to(data.callerId).emit('call-accepted', data);
  });

  socket.on('reject-call', (data) => {
    socket.to(data.callerId).emit('call-rejected', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetUserId).emit('ice-candidate', { senderId: userId, candidate: data.candidate });
  });

  socket.on('end-call', (data) => {
    socket.to(data.targetUserId).emit('call-ended', { senderId: userId });
  });

  socket.on('disconnect', () => {
    const userSockets = activeUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) activeUsers.delete(userId);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Signaling server running on port ${PORT}`));
