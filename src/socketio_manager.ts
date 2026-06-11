/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 *
 * @module socketio_manager
 *
 * Core orchestrator for the Socket.IO integration. The {@link SocketIoManager}
 * owns the Socket.IO server lifecycle (boot/shutdown), the route + group
 * registry, the middleware pipeline and the optional broadcast adapter
 * (resolved through the driver-based {@link SocketIoAdapterContract}).
 *
 * A single instance is registered in the IoC container under the `socketio`
 * binding by the package provider; you rarely instantiate it directly.
 */

import { moduleImporter } from '@adonisjs/core/container'
import { Server } from 'socket.io'
import { WebSocketRoute } from './route.js'
import { WebSocketRouteGroup } from './group.js'

import type { WebSocketCallback, ResolvedWebSocketConfig, GetControllerHandlers } from './types.js'
import type { SocketIoAdapter } from './adapter.js'
import type { Application } from '@adonisjs/core/app'
import type { Constructor, LazyImport } from '@poppinss/utils/types'
import type { Socket } from 'socket.io'

type SocketIoServerFactory = (
  nodeServer: ConstructorParameters<typeof Server>[0],
  socketOptions: ResolvedWebSocketConfig['socketOptions']
) => Server
type InitializeSocketContextMiddleware = Parameters<Server['use']>[0]

/**
 * Manages the Socket.IO server integration with AdonisJS.
 *
 * Responsibilities:
 * - Boot/shutdown the underlying Socket.IO {@link Server} bound to the
 *   AdonisJS HTTP node server (idempotent lifecycle).
 * - Collect event routes and nested route groups (`on()` / `group()`).
 * - Wire the AdonisJS middleware pipeline onto every socket connection.
 * - Resolve and tear down an optional broadcast adapter via the
 *   {@link SocketIoAdapterContract} driver (e.g. Redis for multi-node).
 *
 * Instantiated once by the package provider and exposed through the
 * `socketio` container binding.
 */
export class SocketIoManager {
  /**
   * Socket.IO server instance
   */
  #server: Server | null = null

  /**
   * Special route handler for connection events
   */
  #connectionRoute: WebSocketRoute | undefined = undefined

  /**
   * Collection of all registered event routes
   */
  #routes: WebSocketRoute[] = []

  /**
   * AdonisJS Application instance
   */
  #app: Application<any>

  /**
   * Resolved WebSocket configuration options
   */
  #config: ResolvedWebSocketConfig

  /**
   * Stack of currently open route groups for nested group support
   */
  #openedGroups: WebSocketRouteGroup[] = []

  /**
   * Reference to the connection listener registered on the server
   */
  #onConnection?: (socket: Socket) => Promise<void>

  /**
   * Server factory used by boot. Injectable for tests.
   */
  #serverFactory: SocketIoServerFactory

  /**
   * Optional context initializer middleware override.
   */
  #initializeSocketContext?: InitializeSocketContextMiddleware

  /**
   * Optional adapter teardown callback.
   */
  #adapterTeardown?: () => Promise<void> | void

  constructor(
    app: Application<any>,
    config: ResolvedWebSocketConfig,
    options?: {
      serverFactory?: SocketIoServerFactory
      initializeSocketContext?: InitializeSocketContextMiddleware
    }
  ) {
    this.#app = app
    this.#config = config
    this.#serverFactory =
      options?.serverFactory ??
      ((nodeServer, socketOptions) => {
        return new Server(nodeServer, socketOptions)
      })
    this.#initializeSocketContext = options?.initializeSocketContext
  }

  /**
   * Register a WebSocket event handler
   *
   * @param pattern - Event name to listen for (e.g., 'message', 'chat:send', 'connection')
   * @param handler - Handler function, controller reference, or lazy import
   * @param params - Optional parameter names for extracting from event data
   *
   * @example
   * ```ts
   * // Using inline handler
   * ws.on('message', async ({ socket, params }) => {
   *   socket.emit('response', params)
   * })
   *
   * // Using controller
   * ws.on('chat:send', '#controllers/chat_controller.send')
   *
   * // Using lazy import with parameters
   * ws.on('user:update', [() => import('#controllers/user'), 'update'], ['userId'])
   * ```
   */
  public on<T extends Constructor<any>>(
    pattern: string,
    handler: string | WebSocketCallback | [LazyImport<T> | T, GetControllerHandlers<T>?],
    params: string[] = []
  ): this {
    const callback = new WebSocketRoute(this.#app, {
      pattern,
      handler,
      params: pattern === 'connection' ? [] : params,
    })

    if (pattern === 'connection') {
      this.#connectionRoute = callback
    } else {
      this.#routes.push(callback)
    }

    const openedGroup = this.#openedGroups[this.#openedGroups.length - 1]
    if (openedGroup) {
      openedGroup.routes.push(callback)
    }

    return this
  }

  /**
   * Create a route group for applying common prefixes or middleware
   *
   * @param callback - Function containing route definitions for the group
   * @returns WebSocketRouteGroup instance for further chaining
   *
   * @example
   * ```ts
   * ws.group(() => {
   *   ws.on('list', '#controllers/chat_controller.list')
   *   ws.on('send', '#controllers/chat_controller.send')
   *   ws.on('delete', '#controllers/chat_controller.delete')
   * }).prefix('chat:')
   * ```
   */
  group(callback: () => void): WebSocketRouteGroup {
    /**
     * Create a new group with empty set of routes
     */
    const group = new WebSocketRouteGroup([])

    /**
     * Track the group, so that the upcoming calls inside the callback
     * can use this group
     */
    this.#openedGroups.push(group)

    /**
     * Execute the callback. Now all registered routes will be
     * collected separately from the routes array
     */
    callback()

    /**
     * Now the callback is over, get rid of the opened group
     */
    this.#openedGroups.pop()

    const parentGroup = this.#openedGroups[this.#openedGroups.length - 1]
    if (parentGroup) {
      parentGroup.routes.push(...group.routes)
    }

    return group
  }

  /**
   * Initialize and start the WebSocket server
   * Sets up Socket.IO with the HTTP server and registers all middleware
   * This method is idempotent - calling it multiple times has no effect
   *
   * @example
   * ```ts
   * // Typically called automatically by the provider
   * await ws.boot()
   * ```
   */
  public async boot() {
    if (this.#server) return

    const logger = await this.#app.container.make('logger')
    const adonisServer = await this.#app.container.make('server')
    if (!adonisServer) {
      logger?.error('AdonisJS not available')
      return
    }

    const nodeServer = adonisServer.getNodeServer()
    if (!nodeServer) {
      logger?.error('AdonisJS Node Server not available')
      return
    }

    let initializeSocketContext = this.#initializeSocketContext
    if (!initializeSocketContext) {
      const importedInitializeSocketContext =
        await import('./middleware/initialize_socket_context.js')
      initializeSocketContext = importedInitializeSocketContext.default
    }

    this.#server = this.#serverFactory(nodeServer, this.#config.socketOptions)

    if (this.#config.adapter) {
      const driver = this.#config.adapter
      const adapter: SocketIoAdapter = await driver.boot({ app: this.#app, io: this.#server })
      this.#server.adapter(adapter)
      this.#adapterTeardown = driver.teardown ? () => driver.teardown!() : undefined
      logger?.info(`WebSocket "${driver.name}" adapter enabled`)
    }

    this.#server.use(initializeSocketContext)

    logger?.info('started Websocket Server')

    try {
      for (const middleware of this.#config.middleware) {
        const handler = moduleImporter(middleware as any, 'handle').toHandleMethod()
        this.#server.use(async (socket, next) => {
          let called = false
          const nextOnce = (error?: Error) => {
            if (called) {
              logger?.warn('WebSocket middleware called next() more than once')
              return
            }

            called = true
            next(error)
          }

          try {
            await handler.handle(this.#app.container, socket.context!, nextOnce)
          } catch (error: any) {
            nextOnce(error)
            logger?.error('WebSocket middleware error:', error)
          }
        })
      }
    } catch (err) {
      logger?.error('WebSocket middleware setup failed:', err)
    }

    await this.registerRoute()
  }

  /**
   * Gracefully shutdown the WebSocket server
   * Removes all listeners and closes all connections
   *
   * @example
   * ```ts
   * // Typically called automatically by the provider
   * await ws.shutdown()
   * ```
   */
  public async shutdown() {
    if (!this.#server) return

    const logger = await this.#app.container.make('logger')
    logger?.info('Shutting down WebSocket server')

    this.unregisterRoute()
    if (this.#adapterTeardown) {
      await this.#adapterTeardown()
      this.#adapterTeardown = undefined
    }
    await this.#server.close()
    this.#server = null
  }

  /**
   * Get the underlying Socket.IO server instance
   * Useful for accessing Socket.IO methods directly
   *
   * @returns Socket.IO server instance or null if not initialized
   *
   * @example
   * ```ts
   * const io = ws.server
   * if (io) {
   *   // Broadcast to all clients
   *   io.emit('notification', { message: 'Server update' })
   * }
   * ```
   */
  public get server(): Server | null {
    return this.#server
  }

  /**
   * Register all routes with the Socket.IO server
   * Sets up connection handler and binds all event listeners
   *
   */
  public async registerRoute() {
    if (!this.#server) return

    const logger = await this.#app.container.make('logger')

    this.#onConnection = async (socket) => {
      if (!socket.context) {
        logger?.error('Socket context not initialized')
        socket.disconnect(true)
        return
      }

      logger?.debug(`Client connected: ${socket.id}`)
      socket.once('disconnect', () => {
        socket.context = undefined
      })

      for (const route of this.#routes) {
        logger?.trace(`Registering event handler: ${route.pattern}`)

        socket.on(route.pattern, async (...args) => {
          try {
            await route.handle(
              {
                socket: socket,
                io: this.#server!,
                eventData: {},
                ack: undefined,
                ...socket.context!,
              },
              ...args
            )
          } catch (error) {
            logger?.error(`Error handling event "${route.pattern}":`, error)
          }
        })
      }

      if (this.#connectionRoute) {
        try {
          await this.#connectionRoute.handle({
            socket: socket,
            io: this.#server!,
            eventData: {},
            ack: undefined,
            ...socket.context,
          })
        } catch (error) {
          logger?.error('Connection handler error:', error)
        }
      }
    }

    this.#server.on('connection', this.#onConnection)
  }

  /**
   * Remove all registered event listeners from the Socket.IO server
   *
   */
  public unregisterRoute() {
    if (!this.#server || !this.#onConnection) return

    this.#server.off('connection', this.#onConnection)
    this.#onConnection = undefined
  }
}
