import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'
import { SocketIoManager } from '../src/socketio_manager.js'
import { FakeSocketServer, createFakeApp } from './helpers/fakes.js'

test.group('group prefixes and config', () => {
  test('builds nested prefix as chat:private:message', ({ assert }) => {
    const fakeServer = new FakeSocketServer()
    const { app } = createFakeApp(fakeServer)

    const manager = new SocketIoManager(app, defineConfig({ middleware: [], socketOptions: {} }))

    const outerGroup = manager
      .group(() => {
        manager
          .group(() => {
            manager.on('message', async () => {})
          })
          .prefix('private:')
      })
      .prefix('chat:')

    assert.equal(outerGroup.routes[0].pattern, 'chat:private:message')
  })

  test('defineConfig applies defaults and preserves provided values', ({ assert }) => {
    const middleware = [() => import('./fixtures/throwing_middleware.js')]
    const config = defineConfig({
      middleware,
      socketOptions: { cors: { origin: '*' } },
    })

    // Defaults are filled in
    assert.equal(config.enabled, true)
    assert.isUndefined(config.adapter)
    // Provided values are preserved
    assert.strictEqual(config.middleware, middleware)
    assert.deepEqual(config.socketOptions, { cors: { origin: '*' } })
  })

  test('defineConfig honours an explicit enabled flag and adapter', ({ assert }) => {
    const adapter = { name: 'noop', boot: async () => ({}) as any }
    const config = defineConfig({ enabled: false, adapter })

    assert.equal(config.enabled, false)
    assert.strictEqual(config.adapter, adapter)
    assert.deepEqual(config.middleware, [])
    assert.deepEqual(config.socketOptions, {})
  })
})
