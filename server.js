console.log("🚀 Production Signaling Server Starting...");

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));

app.use(express.json());

const server = http.createServer(app);

// 1. Configure Socket.IO with appropriate timeouts
const io = new Server(server, {
  pingInterval: 10000, // Matches client ping
  pingTimeout: 5000,
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  // 2. Handle the application-level heartbeat
  socket.on("ping-server", (data) => {
    socket.emit("pong-client", { serverTime: Date.now() });
  });

  // ... existing signaling logic
});

// 3. Optional: Add a simple health check route for the HTTP Keep-Alive
app.get("/", (req, res) => res.send("Signaling Server Active"));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const onlineUsers = new Map();

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Messenger Signaling Server Running",
        onlineUsers: onlineUsers.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        websocket: true,
        onlineUsers: onlineUsers.size,
        time: new Date().toISOString()
    });
});

io.on("connection", (socket) => {

    const userId =
        socket.handshake.auth?.userId ||
        socket.handshake.query?.userId ||
        socket.handshake.headers["x-user-id"] ||
        socket.id;

    socket.userId = userId;

    socket.join(userId);

    onlineUsers.set(userId, socket.id);

    console.log(`🟢 ${userId} connected`);

    io.emit("user-online", {
        userId,
        online: true
    });

    socket.on("register-user", (data) => {

        const id = data?.userId || userId;

        socket.userId = id;

        socket.join(id);

        onlineUsers.set(id, socket.id);

        console.log(`✅ Registered : ${id}`);

        io.emit("user-online", {
            userId: id,
            online: true
        });

    });
      // ==========================
    // CALL USER
    // ==========================
    socket.on("call-user", async (data) => {

        try {

            console.log(`[CALL] ${socket.userId} -> ${data.targetUserId}`);

            await supabase
                .from("call_history")
                .insert({
                    caller_id: socket.userId,
                    receiver_id: data.targetUserId,
                    call_type: data.callType || "audio",
                    status: "CALLING",
                    started_at: new Date().toISOString()
                });

            io.to(data.targetUserId).emit("incoming-call", {
                callerId: socket.userId,
                callerName: data.callerName,
                callerPhoto: data.callerPhoto,
                callType: data.callType || "audio"
            });

        } catch (err) {
            console.error(err);
        }

    });

    // ==========================
    // RINGING
    // ==========================
    socket.on("ringing", (data) => {

        io.to(data.targetUserId).emit("incoming-ringing", {
            callerId: socket.userId
        });

    });

    // ==========================
    // ACCEPT CALL
    // ==========================
    socket.on("accept-call", async (data) => {

        await supabase
            .from("call_history")
            .update({
                status: "ACCEPTED"
            })
            .eq("caller_id", data.callerId)
            .eq("receiver_id", socket.userId)
            .eq("status", "CALLING");

        io.to(data.callerId).emit("call-accepted", {
            calleeId: socket.userId
        });

    });

    // ==========================
    // REJECT CALL
    // ==========================
    socket.on("reject-call", (data) => {

        io.to(data.callerId).emit("call-rejected", {
            receiverId: socket.userId
        });

    });

    // ==========================
    // WEBRTC OFFER
    // ==========================
    socket.on("offer", (data) => {

        io.to(data.targetUserId).emit("offer", {
            senderId: socket.userId,
            offer: data.offer
        });

    });

    // ==========================
    // WEBRTC ANSWER
    // ==========================
    socket.on("answer", (data) => {

        io.to(data.targetUserId).emit("answer", {
            senderId: socket.userId,
            answer: data.answer
        });

    });

    // ==========================
    // ICE CANDIDATE
    // ==========================
    socket.on("ice-candidate", (data) => {

        io.to(data.targetUserId).emit("ice-candidate", {
            senderId: socket.userId,
            candidate: data.candidate
        });

    });

    // ==========================
    // END CALL
    // ==========================
    socket.on("end-call", async (data) => {

        await supabase
            .from("call_history")
            .update({
                status: "ENDED",
                ended_at: new Date().toISOString()
            })
            .eq("caller_id", data.callerId)
            .eq("receiver_id", data.targetUserId);

        io.to(data.targetUserId).emit("call-ended", {
            senderId: socket.userId
        });

    });
      // ==========================
    // SEND MESSAGE
    // ==========================
    socket.on("send-message", (data) => {

        io.to(data.targetUserId).emit("receive-message", {
            senderId: socket.userId,
            message: data.message,
            type: data.type || "text",
            image: data.image || null,
            file: data.file || null,
            createdAt: new Date().toISOString()
        });

    });

    // ==========================
    // TYPING
    // ==========================
    socket.on("typing", (data) => {

        io.to(data.targetUserId).emit("typing", {
            senderId: socket.userId
        });

    });

    socket.on("stop-typing", (data) => {

        io.to(data.targetUserId).emit("stop-typing", {
            senderId: socket.userId
        });

    });

    // ==========================
    // MESSAGE SEEN
    // ==========================
    socket.on("message-seen", (data) => {

        io.to(data.targetUserId).emit("message-seen", {
            messageId: data.messageId,
            readerId: socket.userId
        });

    });

    // ==========================
    // HEARTBEAT
    // ==========================
    socket.on("ping-server", () => {

        socket.emit("pong-server", {
            time: Date.now()
        });

    });

    // ==========================
    // DISCONNECT
    // ==========================
    socket.on("disconnect", () => {

        onlineUsers.delete(socket.userId);

        console.log(`🔴 ${socket.userId} disconnected`);

        io.emit("user-offline", {
            userId: socket.userId,
            online: false
        });

    });

    // ==========================
    // SOCKET ERROR
    // ==========================
    socket.on("error", (err) => {

        console.error("Socket Error:", err);

    });

});

// ==========================
// SERVER ERROR
// ==========================
server.on("error", (err) => {

    console.error("Server Error:", err);

});

// ==========================
// START SERVER
// ==========================
const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {

    console.log("==================================");
    console.log("🚀 Messenger Signaling Server");
    console.log(`🌐 Port : ${PORT}`);
    console.log("✅ Production Ready");
    console.log("==================================");

});
