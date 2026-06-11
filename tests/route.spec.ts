import { test } from '@japa/runner'
import { WebSocketRoute } from '../src/route.js'

test.group('WebSocketRoute', () => {
  test('applies single prefix to pattern', ({ assert }) => {
    const route = new WebSocketRoute({} as any, {
      pattern: 'message',
      handler: async () => {},
      params: [],
    })

    route.prefix('chat:')

    assert.equal(route.pattern, 'chat:message')
  })

  test('maps eventData and extracts ack callback', async ({ assert }) => {
    let capturedContext: any
    const ack = () => {}

    const route = new WebSocketRoute({} as any, {
      pattern: 'message',
      handler: async (context) => {
        capturedContext = context
      },
      params: ['message', 'count'],
    })

    await route.handle(
      {
        socket: {} as any,
        io: {} as any,
        eventData: {},
      } as any,
      'hello',
      2,
      ack
    )

    assert.deepEqual(capturedContext.eventData, {
      message: 'hello',
      count: 2,
    })
    assert.equal(capturedContext.ack, ack)
  })
})
