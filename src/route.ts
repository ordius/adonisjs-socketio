/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { moduleCaller, moduleImporter } from '@adonisjs/core/container'

import type { Constructor, LazyImport } from '@poppinss/utils/types'
import type {
  WebSocketAck,
  WebSocketCallback,
  StoreWebSocketRouteHandler,
  WebSocketContext,
} from './types.js'
import type { ApplicationService } from '@adonisjs/core/types'
import type { Application } from '@adonisjs/core/app'
import type { GetControllerHandlers } from './types.js'

/**
 * WebSocketRoute represents a single WebSocket event handler.
 * It manages the event pattern, handler resolution, and parameter extraction.
 *
 */
export class WebSocketRoute<Controller extends Constructor<any> = any> {
  /**
   * Event pattern to listen for
   * @private
   */
  #pattern: string

  /**
   * Parameter names for extracting from event data
   * @private
   */
  #params: string[]

  /**
   * Resolved route handler (function or module handler)
   * @private
   */
  #handler: StoreWebSocketRouteHandler

  /**
   * Reference to the AdonisJS application
   * @private
   */
  #app: Application<any>

  /**
   * Stack of prefixes applied to this route
   * @private
   */
  #prefixes: string[] = []

  /**
   * Create a new WebSocket route
   *
   * @param app - AdonisJS application instance
   * @param options - Route configuration options
   * @param options.pattern - Event name to listen for
   * @param options.handler - Handler function, controller string, or lazy import tuple
   * @param options.params - Array of parameter names to extract from event data
   *
   */
  constructor(
    app: ApplicationService,
    options: {
      pattern: string
      handler:
        | WebSocketCallback
        | string
        | [LazyImport<Controller> | Controller, GetControllerHandlers<Controller>?]
      params: string[]
    }
  ) {
    this.#app = app
    this.#pattern = options.pattern

    const handler = this.#resolveRouteHandle(options.handler)
    this.#handler = handler
    this.#params = options.params
  }

  /**
   * Resolve the route handler to a standardized format
   * Converts string references, lazy imports, or class constructors
   * into a consistent handler structure
   *
   * @param handler - Handler in various formats
   * @returns Normalized handler object
   * @private
   */
  #resolveRouteHandle(
    handler:
      | WebSocketCallback
      | string
      | [LazyImport<Controller> | Controller, GetControllerHandlers<Controller>?]
  ): StoreWebSocketRouteHandler {
    /**
     * Convert magic string to handle method call
     * Example: '#controllers/chat_controller.send'
     */
    if (typeof handler === 'string') {
      const parts = handler.split('.')
      const method = parts.length === 1 ? 'handle' : parts.pop()!
      const moduleRefId = parts.join('.')

      return {
        reference: handler,
        ...moduleImporter(() => this.#app.import(moduleRefId), method).toHandleMethod(),
      } satisfies StoreWebSocketRouteHandler
    }

    /**
     * Using a lazily imported controller or class constructor
     */
    if (Array.isArray(handler)) {
      const controller = handler[0]
      const method = (handler[1] as string) ?? 'handle'

      /**
       * The first item of the tuple is a class constructor
       */
      if (this.#isClass(controller)) {
        return {
          reference: handler,
          ...moduleCaller(controller, method).toHandleMethod(),
        } satisfies StoreWebSocketRouteHandler
      }

      /**
       * The first item of the tuple is a function that lazily
       * loads the controller
       */
      return {
        reference: handler,
        ...moduleImporter(controller, method).toHandleMethod(),
      } satisfies StoreWebSocketRouteHandler
    }

    return handler
  }

  /**
   * Execute the route handler with the provided context and arguments
   * Extracts parameters from arguments based on configured param names
   *
   * @param context - WebSocket context with socket, io, and HTTP context
   * @param args - Event data passed from the client
   * @returns Promise resolving to the handler's return value
   *
   */
  async handle(context: WebSocketContext, ...args: any[]): Promise<any> {
    const eventArgs = [...args]
    const lastArg = eventArgs[eventArgs.length - 1]

    context.ack = typeof lastArg === 'function' ? (eventArgs.pop() as WebSocketAck) : undefined
    context.eventData = Object.fromEntries(this.#params.map((key, i) => [key, eventArgs[i]]))

    if (typeof this.#handler === 'function') {
      return await this.#handler(context)
    }

    return await this.#handler.handle(this.#app.container, context)
  }

  /**
   * Get the full event pattern including all applied prefixes
   * Prefixes are applied in reverse order (LIFO - last in, first out)
   */
  get pattern(): string {
    const prefix = this.#prefixes.slice().reverse().join('')
    return `${prefix}${this.#pattern}`
  }

  /**
   * Add a prefix to the route pattern
   * Multiple prefixes can be added and will be applied in reverse order
   *
   * @param prefix - String to prepend to the event pattern
   * @returns Current route instance for method chaining
   *
   */
  prefix(prefix: string): this {
    this.#prefixes.push(prefix)
    return this
  }

  /**
   * Check if a value is a class constructor
   * @private
   * @template T - Type of the class instance
   * @param value - Value to check
   * @returns True if the value is a class constructor
   */
  #isClass<T = unknown>(
    value: unknown
  ): value is Constructor<T, unknown[]> & {
    prototype: T
  } {
    return typeof value === 'function' && /^class(?:\s+|\{)/v.test(value.toString())
  }
}
