import { test } from '@japa/runner'
import { SocketIoManager } from '../src/socketio_manager.js'
import { redisAdapter } from '../src/adapters/redis.js'
import { FakeSocketServer, createFakeApp } from './helpers/fakes.js'
import { type SocketIoAdapterContract } from '../src/adapter.ts'

/**
 * Helper to build a fully-resolved config for the manager constructor.
 */
function defineResolved(adapter: SocketIoAdapterContract | undefined) {
  return {
    enabled: true,
    middleware: [],
    socketOptions: {},
    adapter,
  }
}

/**
 * Overrides the `redis` container binding on a fake app. Pass `null` to
 * simulate `@adonisjs/redis` not being installed/configured.
 */
function appWithRedis(server: FakeSocketServer, redisService: any | null) {
  const { app, logger } = createFakeApp(server)
  const originalMake = app.container.make
  app.container.make = async (binding: any) => {
    if (binding === 'redis') {
      if (redisService === null) throw new Error('redis not configured')
      return redisService
    }
    return originalMake(binding)
  }
  return { app, logger }
}

test.group('redisAdapter driver', () => {
  test('exposes a redis-named contract', ({ assert }) => {
    const adapter = redisAdapter({ connection: 'main' })
    assert.equal(adapter.name, 'redis')
    assert.isFunction(adapter.boot)
    assert.isFunction(adapter.teardown)
  })

  test('reuses the adonis connection and duplicates it without calling connect', async ({
    assert,
  }) => {
    const server = new FakeSocketServer()

    // The duplicate intentionally has NO `connect()` method: invoking it would
    // throw "Redis is already connecting/connected" (the original crash).
    const subClient = { quit: async () => {}, on: () => {} }
    let capturedConnection: string | undefined
    let duplicated = 0
    const redisService = {
      connection: (name: string) => {
        capturedConnection = name
        return {
          ioConnection: {
            on: () => {},
            duplicate: () => {
              duplicated += 1
              return subClient
            },
          },
        }
      },
    }

    const { app } = appWithRedis(server, redisService)
    const manager = new SocketIoManager(app, defineResolved(redisAdapter({ connection: 'main' })), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()

    assert.equal(capturedConnection, 'main')
    assert.equal(duplicated, 1)
    assert.isNotNull(server.adapterValue)
    assert.isUndefined((subClient as any).connect)
  })

  test('attaches an error handler on both the publisher and subscriber clients', async ({
    assert,
  }) => {
    const server = new FakeSocketServer()
    const pubEvents: string[] = []
    const subEvents: string[] = []
    const subClient = {
      quit: async () => {},
      on: (event: string) => subEvents.push(event),
    }
    const redisService = {
      connection: () => ({
        ioConnection: {
          on: (event: string) => pubEvents.push(event),
          duplicate: () => subClient,
        },
      }),
    }

    const { app } = appWithRedis(server, redisService)
    const manager = new SocketIoManager(app, defineResolved(redisAdapter({ connection: 'main' })), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()

    // Without our handler the redis-adapter logs "missing 'error' handler on
    // this Redis client" and an unhandled error would crash the process.
    assert.include(subEvents, 'error')
    assert.include(pubEvents, 'error')
  })

  test('quits only the duplicated subscriber on shutdown', async ({ assert }) => {
    const server = new FakeSocketServer()
    let quitCalls = 0
    const subClient = {
      quit: async () => {
        quitCalls += 1
      },
      on: () => {},
    }
    const redisService = {
      connection: () => ({ ioConnection: { on: () => {}, duplicate: () => subClient } }),
    }

    const { app } = appWithRedis(server, redisService)
    const manager = new SocketIoManager(app, defineResolved(redisAdapter({ connection: 'main' })), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()
    await manager.shutdown()

    assert.equal(quitCalls, 1)
  })

  test('defaults to the "main" connection when none is provided', async ({ assert }) => {
    const server = new FakeSocketServer()
    let capturedConnection: string | undefined
    const redisService = {
      connection: (name: string) => {
        capturedConnection = name
        return {
          ioConnection: { on: () => {}, duplicate: () => ({ quit: async () => {}, on: () => {} }) },
        }
      },
    }

    const { app } = appWithRedis(server, redisService)
    const manager = new SocketIoManager(app, defineResolved(redisAdapter()), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()
    assert.equal(capturedConnection, 'main')

    await manager.shutdown()
  })

  test('throws a helpful error when @adonisjs/redis is unavailable', async ({ assert }) => {
    const server = new FakeSocketServer()
    const { app } = appWithRedis(server, null)

    const manager = new SocketIoManager(app, defineResolved(redisAdapter({ connection: 'main' })), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await assert.rejects(() => manager.boot(), /requires "@adonisjs\/redis"/)
  })

  test('throws when the named connection cannot be resolved', async ({ assert }) => {
    const server = new FakeSocketServer()
    const brokenService = { connection: () => ({ ioConnection: null }) }
    const { app } = appWithRedis(server, brokenService)

    const manager = new SocketIoManager(
      app,
      defineResolved(redisAdapter({ connection: 'missing' })),
      {
        serverFactory: () => server as any,
        initializeSocketContext: (_socket, next) => next(),
      }
    )

    await assert.rejects(() => manager.boot(), /Unable to resolve redis connection "missing"/)
  })
})

test.group('socketio manager adapter lifecycle', () => {
  test('boots a custom contract adapter and tears it down on shutdown', async ({ assert }) => {
    const server = new FakeSocketServer()
    const { app } = createFakeApp(server)

    let bootCtx: any = null
    let teardownCalls = 0
    const customAdapter = {
      name: 'cluster',
      async boot(ctx: any) {
        bootCtx = ctx
        return { cluster: 'shared' } as any
      },
      async teardown() {
        teardownCalls += 1
      },
    }

    const manager = new SocketIoManager(app, defineResolved(customAdapter), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()

    assert.equal(bootCtx.io, server)
    assert.equal(bootCtx.app, app)
    assert.deepEqual(server.adapterValue, { cluster: 'shared' })

    await manager.shutdown()
    assert.equal(teardownCalls, 1)
  })

  test('skips adapter wiring when none is configured', async ({ assert }) => {
    const server = new FakeSocketServer()
    const { app } = createFakeApp(server)

    const manager = new SocketIoManager(app, defineResolved(undefined), {
      serverFactory: () => server as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    await manager.boot()
    assert.isNull(server.adapterValue)

    await manager.shutdown()
  })
})
