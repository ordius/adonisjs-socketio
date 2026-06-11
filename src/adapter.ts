/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 *
 * @module adapter
 *
 * Driver contract for Socket.IO broadcast adapters. An adapter lets a
 * multi-node deployment share rooms/broadcasts across processes. The
 * {@link SocketIoManager} only depends on {@link SocketIoAdapterContract},
 * so any backend (Redis, Kafka, cluster, ...) can be plugged in by shipping
 * a small factory that returns this contract.
 */

import type { Server } from 'socket.io'
import type { ApplicationService } from '@adonisjs/core/types'

/**
 * The concrete adapter instance accepted by `io.adapter(...)`.
 */
export type SocketIoAdapter = Parameters<Server['adapter']>[0]

/**
 * Context handed to an adapter when the manager boots it.
 */
export interface SocketIoAdapterBootContext {
  /**
   * The AdonisJS application service, used to resolve container bindings
   * (e.g. `redis`) the adapter may depend on.
   */
  app: ApplicationService

  /**
   * The live Socket.IO server instance the adapter will be attached to.
   */
  io: Server
}

/**
 * Driver contract every broadcast adapter must implement.
 *
 * Implementations are typically produced by a helper factory, e.g.
 * `redisAdapter({ connection: 'main' })`, keeping the wiring out of the
 * user's config file.
 */
export interface SocketIoAdapterContract {
  /**
   * Human-readable driver name, used for logging (e.g. `"redis"`).
   */
  readonly name: string

  /**
   * Resolve the concrete Socket.IO adapter. Called once during
   * {@link SocketIoManager} boot, before any route is registered.
   */
  boot(ctx: SocketIoAdapterBootContext): Promise<SocketIoAdapter>

  /**
   * Release any resources acquired in {@link SocketIoAdapterContract.boot}
   * (connections, subscriptions, ...). Called during manager shutdown.
   */
  teardown?(): Promise<void> | void
}
