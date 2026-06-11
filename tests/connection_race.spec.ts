import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { SocketIoManager } from '../src/socketio_manager.js'
import { FakeSocket, FakeSocketServer, createFakeApp } from './helpers/fakes.js'

test.group('connection race condition', () => {
  test('does not lose event emitted while connection handler is pending', async ({ assert }) => {
    const fakeServer = new FakeSocketServer()
    const { app } = createFakeApp(fakeServer)

    const manager = new SocketIoManager(app, defineConfig({ middleware: [], socketOptions: {} }), {
      serverFactory: () => fakeServer as any,
      initializeSocketContext: (_socket, next) => next(),
    })

    const received: string[] = []
    let releaseConnection!: () => void
    const connectionStarted = new Promise<void>((resolveStarted) => {
      releaseConnection = () => resolveStarted()
    })

    let resolveConnection!: () => void
    const holdConnection = new Promise<void>((resolveHold) => {
      resolveConnection = resolveHold
    })

    manager.on('connection', async () => {
      releaseConnection()
      await holdConnection
    })

    manager.on(
      'message',
      async ({ eventData }) => {
        received.push(eventData.body)
      },
      ['body']
    )

    await manager.boot()

    const socket = new FakeSocket('socket-race', { params: {} })
    const connectionPromise = fakeServer.connect(socket)

    await connectionStarted

    await socket.emitFromClient('message', 'hello during connect')
    resolveConnection()
    await connectionPromise

    assert.deepEqual(received, ['hello during connect'])
  })
})
