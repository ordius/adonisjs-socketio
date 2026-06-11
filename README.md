# @ordius/adonisjs-socketio

Socket.IO provider for AdonisJS v7.

## Setup

```sh
npm install @ordius/adonisjs-socketio
node ace configure @ordius/adonisjs-socketio
```

The configure command generates:

- `config/socketio.ts`
- `start/socketio.ts`

## Usage

### Register Event Handlers

```ts
import socketio from '@ordius/adonisjs-socketio/services/main'
import type { WebSocketContext } from '@ordius/adonisjs-socketio/types'

socketio.on('connection', async ({ socket }: WebSocketContext) => {
  socket.emit('welcome', { socketId: socket.id })
})

socketio.on('chat:send', async ({ socket, eventData, ack }: WebSocketContext) => {
  socket.broadcast.emit('chat:new', {
    message: eventData.message,
    senderId: socket.id,
  })

  ack?.({ ok: true })
}, ['message'])
```

### Route Grouping

```ts
socketio
  .group(() => {
    socketio
      .group(() => {
        socketio.on('message', '#controllers/chat_controller.message')
      })
      .prefix('private:')
  })
  .prefix('chat:')

// Final event name: chat:private:message
```

### Controllers

```ts
import type { WebSocketContext } from '@ordius/adonisjs-socketio/types'

export default class ChatController {
  async message({ socket, eventData, ack }: WebSocketContext) {
    socket.emit('chat:echo', eventData)
    ack?.({ ok: true })
  }
}
```

## Multi-node Scaling (Redis Adapter)

Broadcasting across multiple Node processes requires a shared adapter. The
package ships a driver-based Redis adapter that reuses your existing
`@adonisjs/redis` connection — no manual client wiring, no `.connect()`
foot-guns.

```ts
import { defineConfig } from '@ordius/adonisjs-socketio'
import { redisAdapter } from '@ordius/adonisjs-socketio/adapters/redis'

export default defineConfig({
  adapter: redisAdapter({
    connection: 'main', // autocompletes from your config/redis.ts connections
    options: {}, // optional, forwarded to @socket.io/redis-adapter
  }),
})
```

Install the optional peers once:

```sh
node ace add @adonisjs/redis
npm i @socket.io/redis-adapter
```

The adapter duplicates the configured connection for the subscriber client and
quits only that duplicate on shutdown; the primary connection stays owned by
`@adonisjs/redis`.

For load balancers with polling transport, enable sticky session at the LB
layer. Prefer `transports: ['websocket']` to avoid the sticky-session
requirement entirely.

### Custom adapters (Kafka, cluster, ...)

`adapter` accepts any object implementing the `SocketIoAdapterContract`
(`{ name, boot(ctx), teardown?() }`). Ship your own factory the same way
`redisAdapter` does and plug it in — the core never needs to change.

## Security Notes

- Socket.IO is not raw WebSocket: use `socket.io-client` on frontend.
- Handshake auth is a snapshot at connection time.
- Never keep `cors.origin = '*'` in production. Use explicit trusted domains.

## Integration Test With Real Redis

The integration suite drives the package's own `redisAdapter` + `SocketIoManager`
against a real Redis instance to verify cross-node broadcast.

`npm test` runs the regular suite (fakes only, no Redis/Docker required) — this
is the gate that runs everywhere.
`npm run test:integration` runs the Redis-backed suite.

### Providing Redis

The integration runner reads the `REDIS_URL` environment variable. Point it at
any reachable Redis — a local server, a CI service container, or the bundled
Docker Compose file:

```sh
# Local Redis you already have
REDIS_URL=redis://127.0.0.1:6379 npm run quick:test:integration

# Or spin one up via Docker Compose (default: redis://127.0.0.1:6399)
npm run test:integration
```

If `REDIS_URL` is not set, the integration suite is **skipped** (with a
warning) instead of failing — so CI on forks without Redis stays green.

### In CI (recommended)

Use a Redis service container instead of Docker Compose and export `REDIS_URL`:

```yaml
# .github/workflows/ci.yml (excerpt)
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
env:
  REDIS_URL: redis://127.0.0.1:6379
# then: npm run quick:test:integration
```

What the Docker Compose script (`npm run test:integration`) does automatically:

1. Starts Redis from `docker-compose.test.yml`
2. Runs `tests/integration/redis_broadcast.spec.ts`
3. Stops and removes test containers/volumes (even on failure)
