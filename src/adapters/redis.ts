/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 *
 * @module adapters/redis
 *
 * Redis broadcast adapter for multi-node Socket.IO deployments.
 *
 * It reuses the connection managed by `@adonisjs/redis` (no extra primary
 * connection is opened) and duplicates it for the subscriber client, then
 * wires both into `@socket.io/redis-adapter`.
 *
 * Both `@adonisjs/redis` and `@socket.io/redis-adapter` are *optional* peer
 * dependencies: they are referenced through type-only imports and dynamic
 * `import()`, so apps that do not use Redis never need to install them.
 */

import type { SocketIoAdapterContract } from '../adapter.js'

/**
 * Registry of known Redis connection names, used to give `connection` strong
 * autocomplete without creating a hard dependency on `@adonisjs/redis`.
 *
 * Apps using `@adonisjs/redis` can opt into autocomplete by augmenting this
 * interface once (mirroring the keys of their `RedisConnections`):
 *
 * ```ts
 * // types/socketio.ts
 * import type { RedisConnections } from '@adonisjs/redis/types'
 *
 * declare module '@ordius/adonisjs-socketio/adapters/redis' {
 *   interface SocketIoRedisConnections extends RedisConnections {}
 * }
 * ```
 *
 * When left un-augmented it stays empty and `connection` falls back to
 * `string`, so apps without Redis are never broken by typing.
 */
export interface SocketIoRedisConnections {}

/**
 * Resolved connection-name type: the augmented union when available, otherwise
 * a plain `string`.
 */
type RedisConnectionName = keyof SocketIoRedisConnections extends never
  ? string
  : keyof SocketIoRedisConnections & string

/**
 * Options accepted by {@link redisAdapter}.
 */
export interface RedisAdapterOptions<Connection extends string = RedisConnectionName> {
  /**
   * Name of the `@adonisjs/redis` connection to reuse. Autocompletes from the
   * app's configured connections when available. Defaults to `"main"`.
   */
  connection?: Connection

  /**
   * Extra options forwarded verbatim to `@socket.io/redis-adapter`'s
   * `createAdapter(pub, sub, options)`.
   */
  options?: Record<string, any>
}

/**
 * Create a Redis-backed Socket.IO adapter driver.
 *
 * @example
 * ```ts
 * import { defineConfig } from '@ordius/adonisjs-socketio'
 * import { redisAdapter } from '@ordius/adonisjs-socketio/adapters/redis'
 *
 * export default defineConfig({
 *   adapter: redisAdapter({ connection: 'main' }),
 * })
 * ```
 */
export function redisAdapter<Connection extends string = RedisConnectionName>(
  config: RedisAdapterOptions<Connection> = {}
): SocketIoAdapterContract {
  const connectionName = config.connection ?? 'main'

  /**
   * The duplicated subscriber connection we own and must close on teardown.
   * The publisher connection is owned by `@adonisjs/redis` and left untouched.
   */
  let subClient:
    | {
        quit: () => Promise<unknown>
        on: (event: string, listener: (...args: any[]) => void) => void
      }
    | undefined

  return {
    name: 'redis',

    async boot({ app }) {
      const redis = await app.container.make('redis').catch(() => null)
      if (!redis) {
        throw new Error(
          'The redis adapter requires "@adonisjs/redis" to be installed and configured. ' +
            'Run "node ace add @adonisjs/redis" or remove the adapter from your socketio config.'
        )
      }

      const connection = (redis as any).connection(connectionName)
      if (!connection?.ioConnection) {
        throw new Error(
          `Unable to resolve redis connection "${connectionName}". ` +
            'Check the connection name against your config/redis.ts file.'
        )
      }

      /**
       * Reuse the existing ioredis connection as the publisher. Duplicating it
       * yields the subscriber; ioredis connects the duplicate automatically, so
       * we must NOT call `.connect()` on it (doing so throws
       * "Redis is already connecting/connected").
       */
      const pubClient = connection.ioConnection
      const sub = pubClient.duplicate()
      subClient = sub

      /**
       * Attach our own `error` listeners on BOTH clients before wiring the
       * adapter. `@socket.io/redis-adapter` registers a single internal
       * listener and, if it is the only one, logs "missing 'error' handler on
       * this Redis client". The publisher is managed by `@adonisjs/redis` (which
       * already logs its errors), but the duplicated subscriber is owned by us
       * and starts with no listeners — so without this it always triggers the
       * warning and would crash the process on an unhandled `error` event.
       */
      const logger = await app.container.make('logger')
      const logRedisError = (role: 'publisher' | 'subscriber') => (error: unknown) => {
        logger.error({ err: error }, `socket.io redis adapter ${role} client error`)
      }
      sub.on('error', logRedisError('subscriber'))
      ;(pubClient as { on: (event: string, listener: (...args: any[]) => void) => void }).on(
        'error',
        logRedisError('publisher')
      )

      const { createAdapter } = await import('@socket.io/redis-adapter')
      return createAdapter(pubClient, sub, config.options)
    },

    async teardown() {
      if (subClient) {
        await subClient.quit()
        subClient = undefined
      }
    },
  }
}
