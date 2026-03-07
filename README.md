# Cursor Mobile

**Mobile Continuity for Cursor Desktop Conversations**

Continue AI coding conversations from your iPhone using the same project context you have on Cursor desktop.

## Overview

Cursor Mobile is a two-part system:
- **Mac Companion Server** — A Node.js service running locally on your Mac alongside Cursor
- **iPhone App** — A SwiftUI app that connects securely to the Mac companion

### What it does
- View active project conversations from your phone
- Send follow-up messages from mobile
- Continue the same logical thread while away from your computer
- See git metadata: repo name, branch, recent commits, changed files
- Secure device pairing with session-based authentication

### What it is NOT
- Not a Cursor replacement or clone
- Not dependent on Cursor's internal/private state
- A **sidecar continuity layer** for conversation context

## Architecture

```
┌──────────────┐     WebSocket / REST     ┌──────────────┐
│   iPhone     │◄────────────────────────►│  Mac         │
│   App        │    (encrypted, auth'd)   │  Companion   │
│  (SwiftUI)   │                          │  (Node.js)   │
└──────────────┘                          └──────┬───────┘
                                                 │
                                          ┌──────┴───────┐
                                          │   SQLite DB  │
                                          │  + Git CLI   │
                                          └──────────────┘
```

## Project Structure

```
Cursor-mobile/
├── companion-server/          # Mac companion Node.js server
│   ├── src/
│   │   ├── index.js           # Server entry point
│   │   ├── api/routes.js      # REST API endpoints
│   │   ├── auth/pairing.js    # Device pairing & authentication
│   │   ├── db/database.js     # SQLite database layer
│   │   ├── project-discovery/git.js  # Git metadata extraction
│   │   └── ws/websocket.js    # WebSocket real-time sync
│   ├── test/                  # Test suite
│   └── package.json
├── ios-app/                   # iPhone SwiftUI app
│   ├── Package.swift
│   ├── Sources/
│   │   ├── CursorMobileShared/   # Shared models & API client
│   │   └── CursorMobileApp/     # SwiftUI views
│   └── Tests/
└── README.md
```

## Getting Started

### Mac Companion Server

```bash
cd companion-server
npm install
npm start
```

The server starts on port `24842` by default.

### Running Tests

```bash
cd companion-server
npm test
```

### iPhone App

Open `ios-app/Package.swift` in Xcode and build/run on your device or simulator.

## API Reference

### Pairing Endpoints (unauthenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pair/start` | Start device pairing (returns pairing token) |
| POST | `/api/pair/confirm` | Confirm pairing (returns session token) |

### Authenticated Endpoints

All require `Authorization: Bearer <session_token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Server status |
| GET | `/api/projects` | List all projects with git metadata |
| GET | `/api/projects/:id` | Get single project |
| POST | `/api/projects` | Register a project |
| GET | `/api/threads?project_id=...` | List threads for a project |
| POST | `/api/threads` | Create a new thread |
| GET | `/api/threads/:id` | Get single thread |
| GET | `/api/messages?thread_id=...` | List messages in a thread |
| POST | `/api/messages` | Send a message |
| POST | `/api/ack` | Acknowledge message receipt |

### WebSocket

Connect to `/ws?token=<session_token>` for real-time sync events:
- `message.created` — New message in any thread
- `message.acked` — Message acknowledged
- `thread.updated` — Thread metadata changed
- `project.updated` — Project metadata changed
- `connection.changed` — Connection status update

## Data Model

- **Device** — Paired Mac or iPhone with trust status
- **Project** — Detected workspace with git metadata
- **Thread** — Conversation within a project (sidecar/imported/manual)
- **Message** — Individual message with role, source, and delivery state

## Security

- Device pairing uses one-time, short-lived tokens (5 min expiry)
- Session tokens with 7-day expiry and rotation support
- All authenticated endpoints require Bearer token
- WebSocket connections require token authentication
- Device revocation supported

## MVP Scope

**Included:**
- Secure device pairing
- Project detection with git metadata
- Thread and message management
- Real-time sync via WebSocket
- REST API fallback
- Local-first SQLite storage

**Excluded (future):**
- Direct Cursor internal state parsing
- Code editing from phone
- Android support
- Cloud relay
- Voice input
