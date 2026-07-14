# WebRTC Socket.IO Signaling Server

A production-ready Node.js, Express, and Socket.IO signaling server designed specifically for secure peer-to-peer WebRTC audio and video calling.

## Features

- **Supabase Authentication**: Integrated directly with Supabase Auth. Only authenticated users can connect, register, or signal each other.
- **Robust Signaling Flow**: Complete handling of WebRTC Offers, Answers, ICE Candidates, Call Rejection, and Call End events.
- **Render Ready**: Includes `render.yaml` configuration for immediate free-tier deployment.
- **Offline/Permissive Fallback**: Allows local sandbox development when environment keys are omitted.

## Local Setup

1. Navigate to this directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your Supabase variables:
   ```bash
   cp .env.example .env
   ```
4. Start the server:
   ```bash
   npm start
   ```

## Render Deployment

To deploy this to [Render](https://render.com):

1. Create a free account on Render.
2. Click **New +** and select **Blueprints**.
3. Connect your GitHub repository containing this project.
4. Render will automatically parse `render.yaml` and prompt you to configure `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
5. Deploy! Once deployed, copy your app's web service URL (e.g. `https://webrtc-signaling-server.onrender.com`) and add it to your Android app's environment configuration as `SOCKET_SERVER_URL`.
