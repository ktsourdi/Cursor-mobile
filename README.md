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
- Auto-discover git projects on your Mac
- Secure device pairing with session-based authentication
- Real-time sync via WebSocket

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
│   │   ├── index.js           # Server entry point (env config, graceful shutdown)
│   │   ├── api/routes.js      # REST API endpoints (full CRUD + scan)
│   │   ├── auth/pairing.js    # Device pairing & authentication
│   │   ├── db/database.js     # SQLite database layer
│   │   ├── project-discovery/git.js  # Git metadata extraction
│   │   └── ws/websocket.js    # WebSocket real-time sync
│   ├── test/                  # Test suite (79 tests)
│   ├── deploy/                # Deployment configs (macOS launchd)
│   ├── Dockerfile             # Docker container build
│   └── package.json
├── ios-app/                   # iPhone SwiftUI app
│   ├── Package.swift
│   ├── Sources/
│   │   ├── CursorMobileShared/   # Shared models & API client
│   │   └── CursorMobileApp/     # SwiftUI views
│   └── Tests/
└── README.md
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+ (recommended: 20 LTS)
- **Git** (for project discovery)
- **npm** (included with Node.js)
- **macOS** (for companion server) or any OS with Node.js + Docker
- **Xcode 15+** (for iOS app, macOS only)

### 1. Install & Start the Mac Companion Server

```bash
# Clone the repository
git clone https://github.com/ktsourdi/Cursor-mobile.git
cd Cursor-mobile/companion-server

# Install dependencies
npm install

# Start the server
npm start
```

You'll see:

```
Cursor Mobile Companion server running on 0.0.0.0:24842
Database: /path/to/companion.db
WebSocket: ws://0.0.0.0:24842/ws
Health check: http://0.0.0.0:24842/health
Ready to accept connections.
```

### 2. Verify the Server is Running

```bash
curl http://localhost:24842/health
# → {"status":"ok","uptime":5.123}

curl http://localhost:24842/api/status
# → {"status":"ok","version":"1.0.0","connected_devices":0,"project_count":0}
```

### 3. Build & Run the iPhone App

```bash
# Open in Xcode
cd ios-app
open Package.swift
```

1. Select your target device or simulator
2. Build and run (`Cmd+R`)
3. Enter the server address (e.g., `192.168.1.100:24842`)
4. Complete the pairing flow

---

## Configuration

The server is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPANION_PORT` | `24842` | HTTP/WebSocket port |
| `COMPANION_HOST` | `0.0.0.0` | Bind address |
| `COMPANION_DB_PATH` | `./companion.db` | SQLite database file path |

Example:

```bash
COMPANION_PORT=8080 COMPANION_DB_PATH=/var/data/companion.db npm start
```

---

## Deployment

### Option A: Run directly on macOS

Best for personal use on your own Mac.

```bash
cd companion-server
npm install --production
npm start
```

### Option B: macOS Background Service (launchd)

Runs automatically on login and survives reboots:

```bash
# 1. Copy server files to a permanent location
sudo mkdir -p /usr/local/lib/cursor-mobile-companion
sudo cp -r companion-server/* /usr/local/lib/cursor-mobile-companion/
cd /usr/local/lib/cursor-mobile-companion && npm install --production

# 2. Create data directory
sudo mkdir -p /usr/local/var/cursor-mobile

# 3. Edit the plist to match your node path
#    Check: which node
#    Update <string>/usr/local/bin/node</string> if needed

# 4. Install the Launch Agent
cp companion-server/deploy/com.cursor-mobile.companion.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cursor-mobile.companion.plist

# 5. Verify it's running
curl http://localhost:24842/health

# View logs
tail -f /tmp/cursor-mobile-companion.log

# Stop the service
launchctl unload ~/Library/LaunchAgents/com.cursor-mobile.companion.plist
```

### Option C: Docker

```bash
cd companion-server

# Build the image
docker build -t cursor-mobile-companion .

# Run with persistent data
docker run -d \
  --name cursor-companion \
  -p 24842:24842 \
  -v cursor-mobile-data:/data \
  cursor-mobile-companion

# Verify
curl http://localhost:24842/health

# View logs
docker logs cursor-companion

# Stop
docker stop cursor-companion
```

---

## Usage Walkthrough

### Complete Flow: Install → Pair → Chat

#### Step 1: Start the Server

```bash
cd companion-server && npm install && npm start
```

#### Step 2: Pair a Device

```bash
# Start pairing (returns a device_id and pairing_token)
curl -s -X POST http://localhost:24842/api/pair/start \
  -H 'Content-Type: application/json' \
  -d '{"device_name":"My iPhone","platform":"iphone"}' | jq .

# Response:
# {
#   "device_id": "abc-123-...",
#   "pairing_token": "a1b2c3d4...",
#   "expires_at": "2025-01-01T00:05:00.000Z"
# }
```

```bash
# Confirm pairing (use the device_id and pairing_token from above)
curl -s -X POST http://localhost:24842/api/pair/confirm \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"abc-123-...","pairing_token":"a1b2c3d4..."}' | jq .

# Response:
# {
#   "session_token": "your-session-token-here",
#   "expires_at": "2025-01-08T00:00:00.000Z"
# }
```

Save the `session_token` — you'll use it for all subsequent requests.

#### Step 3: Discover Projects

```bash
# Auto-scan a directory for git repos
TOKEN="your-session-token-here"

curl -s -X POST http://localhost:24842/api/projects/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scan_path":"/Users/you/Projects"}' | jq .

# Response:
# {
#   "scanned_path": "/Users/you/Projects",
#   "discovered": 3,
#   "projects": [
#     { "id": "...", "name": "my-app", "action": "created", ... },
#     { "id": "...", "name": "api-server", "action": "created", ... }
#   ]
# }
```

```bash
# List all projects (with live git metadata)
curl -s http://localhost:24842/api/projects \
  -H "Authorization: Bearer $TOKEN" | jq .
```

#### Step 4: Start a Conversation Thread

```bash
# Create a thread in a project
curl -s -X POST http://localhost:24842/api/threads \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"project_id":"<project-id>","title":"Refactor auth module"}' | jq .
```

#### Step 5: Send Messages

```bash
# Send a message from mobile
curl -s -X POST http://localhost:24842/api/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "thread_id": "<thread-id>",
    "role": "user",
    "body": "Can you refactor the auth middleware to support refresh tokens?"
  }' | jq .

# List messages in a thread
curl -s "http://localhost:24842/api/messages?thread_id=<thread-id>" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

#### Step 6: Real-time Sync via WebSocket

```bash
# Connect via WebSocket (use wscat or similar tool)
npx wscat -c "ws://localhost:24842/ws?token=$TOKEN"

# You'll receive real-time events:
# {"type":"connection.changed","data":{"status":"connected","device_id":"..."}}
# {"type":"message.created","data":{"id":"...","body":"Hello!","role":"user",...}}
# {"type":"message.acked","data":{"id":"...","state":"acked",...}}
```

---

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
| GET | `/api/devices` | List paired devices |
| DELETE | `/api/devices/:id` | Revoke a device |
| GET | `/api/projects` | List all projects with live git metadata |
| POST | `/api/projects` | Register a project |
| POST | `/api/projects/scan` | Auto-discover git repos from a directory |
| GET | `/api/projects/:id` | Get single project with git metadata |
| PUT | `/api/projects/:id` | Update project metadata |
| DELETE | `/api/projects/:id` | Delete a project |
| GET | `/api/threads?project_id=...` | List threads for a project |
| POST | `/api/threads` | Create a new thread |
| GET | `/api/threads/:id` | Get single thread |
| PUT | `/api/threads/:id` | Update thread title/status |
| DELETE | `/api/threads/:id` | Delete a thread |
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

---

## Testing

```bash
cd companion-server
npm install
npm test
```

**79 tests** across 6 test suites:
- `database.test.js` — SQLite CRUD for all tables
- `auth.test.js` — Pairing flow, session tokens, expiry, revocation
- `api.test.js` — REST endpoints integration tests
- `extended-api.test.js` — PUT/DELETE endpoints, device management, project scan
- `websocket.test.js` — WebSocket auth, real-time broadcast, ack events
- `git.test.js` — Git repo detection, metadata extraction, directory scanning

---

## Data Model

- **Device** — Paired Mac or iPhone with trust/revoke status
- **Project** — Detected workspace with git metadata (branch, commit, changed files)
- **Thread** — Conversation within a project (sidecar/imported/manual, active/archived)
- **Message** — Individual message with role (user/assistant/system/tool), source (mac/mobile), and delivery state (pending/sent/acked/failed)
- **SyncEvent** — Audit trail for all sync operations

## Security

- Device pairing uses one-time, short-lived tokens (5 min expiry)
- Session tokens with 7-day expiry and rotation support
- All authenticated endpoints require Bearer token
- WebSocket connections require token authentication
- Device revocation supported (immediate invalidation)
- Graceful shutdown on SIGINT/SIGTERM
- No sensitive data logged by default

## MVP Scope

**Included:**
- ✅ Secure device pairing with token-based auth
- ✅ Project detection with git metadata
- ✅ Auto-discovery of git repos (`POST /projects/scan`)
- ✅ Full CRUD for projects, threads, messages
- ✅ Device management (list, revoke)
- ✅ Real-time sync via WebSocket
- ✅ REST API fallback
- ✅ Local-first SQLite storage
- ✅ Docker deployment
- ✅ macOS launchd service
- ✅ 79 passing tests

**Excluded (future phases):**
- Direct Cursor internal state parsing
- Code editing from phone
- Android support
- Cloud relay / NAT traversal
- Voice input
- Push notifications (APNs)
- Multi-user collaboration
