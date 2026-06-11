import type { Server, ServerOptions, Socket } from 'socket.io'
import type { HttpContext } from '@adonisjs/core/http'
import type { Constructor, LazyImport } from '@poppinss/utils/types'
import type { ModuleHandler } from '@adonisjs/core/types/container'
import type { SocketIoAdapterContract } from './adapter.js'

export type SocketIoMiddlewareInput = LazyImport<any>

/**
 * User-facing Socket.IO configuration. All fields are optional; sensible
 * defaults are applied by {@link defineConfig}.
 */
export interface WebSocketConfig {
  /**
   * Toggle the whole integration. When `false`, the provider skips booting
   * the Socket.IO server (useful for `console`/`test` environments).
   *
   * @default true
   */
  enabled?: boolean

  /**
   * Connection-level middleware applied to every socket, as lazy imports.
   */
  middleware?: SocketIoMiddlewareInput[]

  /**
   * Options forwarded to the underlying Socket.IO server.
   */
  socketOptions?: Partial<ServerOptions>

  /**
   * Optional broadcast adapter driver for multi-node scaling, e.g.
   * `redisAdapter({ connection: 'main' })`.
   */
  adapter?: SocketIoAdapterContract
}

/**
 * Configuration after {@link defineConfig} has applied defaults. This is the
 * shape the {@link SocketIoManager} and provider consume internally.
 */
export interface ResolvedWebSocketConfig {
  enabled: boolean
  middleware: SocketIoMiddlewareInput[]
  socketOptions: Partial<ServerOptions>
  adapter?: SocketIoAdapterContract
}

export type WebSocketAck = (...args: any[]) => void

export type WebSocketContext = {
  socket: Socket
  io: Server
  eventData: Record<string, any>
  ack?: WebSocketAck
} & Omit<HttpContext, 'response' | 'inspect' | 'params'>

export type WebSocketCallback = (ctx: WebSocketContext) => Promise<void>

export type GetControllerHandlers<Controller extends Constructor<any>> = {
  [K in keyof InstanceType<Controller>]: InstanceType<Controller>[K] extends (
    ctx: WebSocketContext,
    ...args: any[]
  ) => any
    ? K
    : never
}[keyof InstanceType<Controller>]

export type SocketIoMiddleware = Parameters<Server['use']>[0]

export type StoreWebSocketRouteHandler =
  | WebSocketCallback
  | ({
      reference: string | [LazyImport<Constructor<any>> | Constructor<any>, any?]
    } & Omit<ModuleHandler<undefined, [WebSocketContext]>, 'name'>)
