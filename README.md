# LIE-FI 🎭

**Bluff. Guess. Win.**

LIE-FI is a real-time multiplayer bluffing game where players submit fake answers, identify the correct one, and score by either guessing right or successfully bluffing others.

## Features
- Real-time multiplayer gameplay
- Solo and Team (2v2) modes
- Private team chat
- Reconnect support with score persistence
- Live leaderboard updates
- Timed rounds and voting

## Tech Stack
**Frontend:** HTML, CSS, JavaScript  
**Backend:** Node.js, Express.js, Socket.IO

## Computer Networks Concepts Used
- **Client–Server Architecture** for centralized game state management
- **WebSocket Communication** for low-latency real-time interaction
- **Room-Based Communication** for isolated game sessions and team chat
- **Event-Driven Networking** using Socket.IO events
- **Fault Tolerance** through reconnect handling and host reassignment

## Setup
```bash
git clone <repository-url>
cd LIE-FI
npm install
node server/server.js