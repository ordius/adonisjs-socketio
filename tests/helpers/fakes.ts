import type { Server } from 'socket.io'

type Middleware = Parameters<Server['use']>[0]

type Logger = {
  info: (...args: any[]) => void
  error: (...args: any[]) => void
  warn: (...args: any[]) => void
  debug: (...args: any[]) => void
  trace: (...args: any[]) => void
}

export class FakeSocket {
  public id: string
  public context: any
  public disconnected = false

  #listeners = new Map<string, Array<(...args: any[]) => any>>()
  #onceListeners = new Map<string, Array<(...args: any[]) => any>>()

  constructor(id = 'socket-1', context: any = { params: {} }) {
    this.id = id
    this.context = context
  }

  on(event: string, handler: (...args: any[]) => any) {
    const handlers = this.#listeners.get(event) ?? []
    handlers.push(handler)
    this.#listeners.set(event, handlers)
    return this
  }

  once(event: string, handler: (...args: any[]) => any) {
    const handlers = this.#onceListeners.get(event) ?? []
    handlers.push(handler)
    this.#onceListeners.set(event, handlers)
    return this
  }

  async emitFromClient(event: string, ...args: any[]) {
    const handlers = this.#listeners.get(event) ?? []
    await Promise.all(handlers.map((handler) => handler(...args)))
  }

  async emitLifecycle(event: string, ...args: any[]) {
    const handlers = this.#onceListeners.get(event) ?? []
    this.#onceListeners.delete(event)
    await Promise.all(handlers.map((handler) => handler(...args)))
  }

  disconnect() {
    this.disconnected = true
    return this
  }

  listenerCount(event: string) {
    return (this.#listeners.get(event) ?? []).length
  }
}

export class FakeSocketServer {
  public middlewares: Middleware[] = []
  public closeCalled = false
  public adapterValue: any = null

  #connectionHandlers: Array<(socket: FakeSocket) => Promise<void> | void> = []

  use(middleware: Middleware) {
    this.middlewares.push(middleware)
    return this
  }

  on(event: string, handler: (socket: FakeSocket) => Promise<void> | void) {
    if (event === 'connection') {
      this.#connectionHandlers.push(handler)
    }

    return this
  }

  off(event: string, handler: (socket: FakeSocket) => Promise<void> | void) {
    if (event !== 'connection') return this

    this.#connectionHandlers = this.#connectionHandlers.filter((entry) => entry !== handler)
    return this
  }

  async close() {
    this.closeCalled = true
  }

  adapter(adapter: any) {
    this.adapterValue = adapter
    return this
  }

  async connect(socket: FakeSocket) {
    for (const middleware of this.middlewares) {
      await new Promise<void>((resolve, reject) => {
        middleware(socket as any, (error?: Error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }

    await Promise.all(this.#connectionHandlers.map((handler) => handler(socket)))
  }

  connectionListenerCount() {
    return this.#connectionHandlers.length
  }
}

export function createFakeApp(_server: FakeSocketServer, logger?: Partial<Logger>) {
  const fakeLogger: Logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
    ...logger,
  }

  const app = {
    container: {
      make: async (binding: any) => {
        if (binding === 'logger') return fakeLogger
        if (binding === 'server') {
          return {
            getNodeServer: () => ({ fake: true }),
          }
        }

        if (binding === 'redis') {
          return {
            connection: () => ({
              ioConnection: { on: () => {}, duplicate: () => ({ on: () => {} }) },
            }),
          }
        }

        if (typeof binding === 'function') {
          return new binding()
        }

        return null
      },
      call: (value: any, method: string, args: any[]) => {
        if (typeof value === 'function') {
          return value(...args)
        }

        if (value && typeof value[method] === 'function') {
          return value[method](...args)
        }

        throw new Error(`Cannot call method ${method}`)
      },
      createResolver: () => {
        return app.container
      },
    },
  }

  return { app: app as any, logger: fakeLogger }
}
