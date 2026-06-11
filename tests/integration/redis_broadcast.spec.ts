import { test } from '@japa/runner'
import { createServer } from 'node:http'
import { Redis } from 'ioredis'
import { io as createSocketClient, type Socket as ClientSocket } from 'socket.io-client'
import { SocketIoManager } from '../../src/socketio_manager.js'
import { redisAdapter } from '../../src/adapters/redis.js'

/**
 * Integration suite: drives the package's own `redisAdapter` + `SocketIoManager`
 * against a REAL Redis to verify cross-node broadcast.
 *
 * Redis is provided via the `REDIS_URL` env var (a local server, a CI service
 * container, or the bundled docker-compose). When it is absent the whole suite
 * is skipped so CI without Redis stays green.
 */
const REDIS_URL = process.env.REDIS_URL

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function closeHttpServer(server: ReturnType<typeof createServer>) {
  if (!server.listening) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

/**
 * Builds a minimal fake AdonisJS app whose `redis` binding returns an ioredis
 * connection keyed by name — exactly what `redisAdapter` consumes in production.
 */
function createRedisBackedApp(redisUrl: string) {
  const ioConnection = new Redis(redisUrl, { lazyConnect: false })
  const redisService = {
    connection: (_name: string) => ({ ioConnection }),
  }

  const logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
  }

  let nodeServer: any = null
  const app = {
    setNodeServer(server: any) {
      nodeServer = server
    },
    container: {
      make: async (binding: any) => {
        if (binding === 'logger') return logger
        if (binding === 'redis') return redisService
        if (binding === 'server') return { getNodeServer: () => nodeServer }
        return null
      },
    },
  }

  return { app: app as any, primaryConnection: ioConnection }
}

/**
 * Spins up one Socket.IO node managed by the package's SocketIoManager wired to
 * the Redis adapter. Returns the public URL plus a disposer.
 */
async function setupManagedNode(redisUrl: string) {
  const httpServer = createServer()
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
  })

  const address = httpServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve dynamic port for test server')
  }

  const { app, primaryConnection } = createRedisBackedApp(redisUrl)
  app.setNodeServer(httpServer)

  const manager = new SocketIoManager(app, {
    enabled: true,
    middleware: [],
    socketOptions: { transports: ['websocket'], cors: { origin: '*' } },
    adapter: redisAdapter({ connection: 'main' }),
  })

  // Echo handler used to trigger a cross-node broadcast.
  manager.on('connection', async ({ socket, io }) => {
    socket.on('broadcast:test', (payload: { text: string }) => {
      io.emit('broadcast:received', payload)
    })
  })

  await manager.boot()

  return {
    url: `http://127.0.0.1:${address.port}`,
    async dispose() {
      await manager.shutdown()
      await primaryConnection.quit()
      await closeHttpServer(httpServer)
    },
  }
}

test.group('redis adapter end-to-end broadcast', (group) => {
  const closers: Array<() => Promise<void>> = []

  // Skip the whole group unless a real Redis is provided via REDIS_URL.
  group.tap((t) => {
    if (!REDIS_URL) {
      t.skip(true, 'REDIS_URL not set — skipping Redis integration test')
    }
  })

  group.each.setup(async () => {
    return async () => {
      while (closers.length > 0) {
        const close = closers.pop()!
        await close()
      }
    }
  })

  test('broadcasts events across 2 socket.io nodes via the redis adapter', async ({ assert }) => {
    const redisUrl = REDIS_URL as string

    const nodeA = await setupManagedNode(redisUrl)
    const nodeB = await setupManagedNode(redisUrl)

    closers.push(async () => {
      await nodeA.dispose()
      await nodeB.dispose()
    })

    const clientA: ClientSocket = createSocketClient(nodeA.url, {
      transports: ['websocket'],
      reconnection: false,
    })

    const clientB: ClientSocket = createSocketClient(nodeB.url, {
      transports: ['websocket'],
      reconnection: false,
    })

    closers.push(async () => {
      clientA.disconnect()
      clientB.disconnect()
    })

    await withTimeout(
      Promise.all([
        new Promise<void>((resolve, reject) => {
          clientA.on('connect', () => resolve())
          clientA.on('connect_error', (error) => reject(error))
        }),
        new Promise<void>((resolve, reject) => {
          clientB.on('connect', () => resolve())
          clientB.on('connect_error', (error) => reject(error))
        }),
      ]),
      10000,
      'Timed out while waiting clients to connect'
    )

    const receivedPayload = await withTimeout(
      new Promise<{ text: string }>((resolve) => {
        clientB.on('broadcast:received', (payload) => resolve(payload))
        clientA.emit('broadcast:test', { text: 'hello-from-node-a' })
      }),
      10000,
      'Timed out waiting for cross-node broadcast'
    )

    assert.equal(receivedPayload.text, 'hello-from-node-a')
  })
})
