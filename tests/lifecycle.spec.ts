import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { SocketIoManager } from '../src/socketio_manager.js'
import { FakeSocket, FakeSocketServer, createFakeApp } from './helpers/fakes.js'

test.group('lifecycle and middleware', () => {
  test('boot shutdown and reboot keeps server lifecycle healthy', async ({ assert }) => {
    const firstServer = new FakeSocketServer()
    const secondServer = new FakeSocketServer()
    const servers = [firstServer, secondServer]
    let index = 0

    const { app } = createFakeApp(firstServer)

    const manager = new SocketIoManager(app, defineConfig({ middleware: [], socketOptions: {} }), {
      serverFactory: () => servers[index++] as any,
      initializeSocketContext: (_socket, next) => {
        next()
      },
    })

    await manager.boot()
    assert.equal(firstServer.connectionListenerCount(), 1)
    assert.isNotNull(manager.server)

    await manager.shutdown()
    assert.isTrue(firstServer.closeCalled)
    assert.equal(firstServer.connectionListenerCount(), 0)
    assert.isNull(manager.server)

    await manager.boot()
    assert.equal(secondServer.connectionListenerCount(), 1)
    assert.isNotNull(manager.server)

    await manager.shutdown()
    assert.isTrue(secondServer.closeCalled)
    assert.equal(secondServer.connectionListenerCount(), 0)
    assert.isNull(manager.server)
  })

  test('middleware failure rejects connection and does not hang', async ({ assert }) => {
    const fakeServer = new FakeSocketServer()
    const { app } = createFakeApp(fakeServer)

    const manager = new SocketIoManager(
      app,
      defineConfig({
        middleware: [() => import('./fixtures/throwing_middleware.js')],
        socketOptions: {},
      }),
      {
        serverFactory: () => fakeServer as any,
        initializeSocketContext: (_socket, next) => {
          next()
        },
      }
    )

    await manager.boot()

    await assert.rejects(async () => {
      await fakeServer.connect(new FakeSocket('socket-middleware'))
    }, /middleware failed/)
  })
})
