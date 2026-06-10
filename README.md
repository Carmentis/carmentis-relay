<p align="center">
  <img src="assets/carmentis.svg" width="160" alt="Carmentis logo" />
</p>

# Carmentis Relay

A lightweight signaling and message-relay server that brokers secure, ephemeral
peer-to-peer sessions between two parties: an **initiator** and a **joiner**.

The relay is built with [NestJS](https://nestjs.com/) and uses
[Socket.IO](https://socket.io/) for real-time, bidirectional communication. It
acts purely as a message conduit — it pairs two clients into a session and
forwards messages between them without inspecting or persisting their content.

## How it works

A session connects exactly two peers and follows a simple lifecycle:

1. A client calls the REST endpoint `POST /session/create` to obtain a unique
   `sessionId`.
2. The **initiator** opens a WebSocket connection and emits `init` with the
   `sessionId`. The relay marks the session as initialized.
3. The **joiner** opens a WebSocket connection and emits `join` with the same
   `sessionId`. Once both peers are connected, the relay emits `session-ready`
   to both.
4. Either peer can now emit `message` events; the relay forwards each message to
   the other peer.
5. When either peer disconnects, the relay notifies the remaining peer with
   `peer-disconnected`, disconnects it, and deletes the session.

Sessions are held in memory only. They are created on demand and destroyed as
soon as a peer leaves — nothing is written to disk or to a database.

```
  Initiator                Relay                  Joiner
     │                       │                       │
     │  POST /session/create │                       │
     │──────────────────────▶│                       │
     │   { sessionId }       │                       │
     │◀──────────────────────│                       │
     │                       │                       │
     │  emit "init"          │                       │
     │──────────────────────▶│                       │
     │  "initialized"        │                       │
     │◀──────────────────────│                       │
     │                       │       emit "join"     │
     │                       │◀──────────────────────│
     │                       │       "joined"        │
     │                       │──────────────────────▶│
     │  "session-ready"      │      "session-ready"  │
     │◀──────────────────────│──────────────────────▶│
     │                       │                       │
     │  emit "message"       │                       │
     │──────────────────────▶│       "message"       │
     │                       │──────────────────────▶│
     │                       │                       │
```

## API reference

### REST

| Method | Path              | Description                                     |
| ------ | ----------------- | ----------------------------------------------- |
| `GET`  | `/`               | Health check. Returns `Hello World!`.           |
| `POST` | `/session/create` | Creates a new session. Returns `{ sessionId }`. |

### WebSocket (Socket.IO)

The Socket.IO server is exposed on the same port as the HTTP server.

**Events emitted by the client:**

| Event     | Payload                 | Description                                     |
| --------- | ----------------------- | ----------------------------------------------- |
| `init`    | `{ sessionId: string }` | Register as the session initiator.              |
| `join`    | `{ sessionId: string }` | Register as the session joiner.                 |
| `message` | any                     | Forward an arbitrary payload to the other peer. |

**Events emitted by the server:**

| Event               | Payload                 | Description                                          |
| ------------------- | ----------------------- | ---------------------------------------------------- |
| `initialized`       | `{ sessionId: string }` | The initiator was registered.                        |
| `joined`            | `{ sessionId: string }` | The joiner was registered.                           |
| `session-ready`     | —                       | Both peers are connected; messaging may begin.       |
| `message`           | any                     | A payload forwarded from the other peer.             |
| `peer-disconnected` | —                       | The other peer left; this connection will be closed. |
| `error`             | `{ message: string }`   | The request was rejected (see reasons below).        |

**Error conditions** (the connection is closed after an `error` is emitted):

- `Session not found` — the `sessionId` is unknown.
- `Session already initialized` — an initiator already claimed the session.
- `Session not yet initialized` — a joiner connected before the initiator.
- `Session already has a joiner` — the session is full.

## Requirements

- [Node.js](https://nodejs.org/) 20 or later
- [pnpm](https://pnpm.io/) (the project ships a `pnpm-lock.yaml`)

Install pnpm if you don't have it:

```bash
npm install -g pnpm
```

## Local deployment

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run the server

```bash
# Development (rebuilds on change)
pnpm run start:dev

# Plain start
pnpm run start

# Production (runs the compiled output in dist/)
pnpm run build
pnpm run start:prod
```

The server listens on port **3000** by default. Override it with the `PORT`
environment variable:

```bash
PORT=8080 pnpm run start
```

### 3. Verify it's running

```bash
curl http://localhost:3000/
# -> Hello World!

curl -X POST http://localhost:3000/session/create
# -> {"sessionId":"<32-hex-character id>"}
```

## Docker deployment

### Option A — pull the pre-built image

A multi-stage image is published to the GitHub Container Registry by CI on every
push to the default branch and on version tags.

```bash
docker pull ghcr.io/carmentis/relay:latest

docker run -p 3000:3000 ghcr.io/carmentis/relay:latest
```

Available tags include `latest`, the branch name, version tags (e.g. `1.2.3`,
`1.2`, `1`), and commit-SHA tags. See the
[GitHub Actions workflow](.github/workflows) for the full tagging strategy.

### Option B — build the image locally

```bash
docker build -t carmentis-relay .

docker run -p 3000:3000 carmentis-relay
```

The `Dockerfile` uses a two-stage build: the first stage compiles the
TypeScript sources, and the second stage installs production dependencies only
and runs `node dist/main.js`. `NODE_ENV` is set to `production` in the final
image.

### Configuration

| Variable   | Default | Description                       |
| ---------- | ------- | --------------------------------- |
| `PORT`     | `3000`  | Port the server listens on.       |
| `NODE_ENV` | —       | Set to `production` in the image. |

To change the port at runtime:

```bash
docker run -e PORT=8080 -p 8080:8080 carmentis-relay
```

## Development

```bash
# Run the linter (auto-fixes where possible)
pnpm run lint

# Format the codebase with Prettier
pnpm run format
```

## Testing

```bash
# Unit tests
pnpm run test

# Watch mode
pnpm run test:watch

# Coverage report
pnpm run test:cov

# End-to-end tests
pnpm run test:e2e
```

## Project structure

```
src/
├── main.ts                     # Application bootstrap (CORS + listen)
├── app.module.ts               # Root module
├── app.controller.ts           # Health-check endpoint
├── app.service.ts
└── session/
    ├── session.module.ts
    ├── session.controller.ts   # POST /session/create
    ├── session.service.ts      # In-memory session store
    └── session.gateway.ts      # Socket.IO gateway (init/join/message)
```

## Notes & limitations

- **In-memory state.** Sessions live only in the process memory of a single
  instance. The relay is therefore not horizontally scalable as-is; running
  multiple replicas requires a shared session store or sticky routing so that
  both peers of a session land on the same instance.
- **CORS is fully open.** Both the HTTP layer (`src/main.ts`) and the Socket.IO
  gateway accept any origin (`*`). Restrict this before exposing the relay
  publicly.
- **Opaque relaying.** The server forwards `message` payloads verbatim and does
  not read or store their content; end-to-end confidentiality is the
  responsibility of the peers.

## License

UNLICENSED — see `package.json`.
