/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import type { ResolvedWebSocketConfig, WebSocketConfig } from './types.js'

/**
 * Define the Socket.IO configuration with type-safety and sane defaults.
 *
 * Every field is optional at the call site; missing values are filled in
 * here so the provider and {@link SocketIoManager} always receive a fully
 * resolved config.
 */
export function defineConfig(config: WebSocketConfig = {}): ResolvedWebSocketConfig {
  return {
    enabled: config.enabled ?? true,
    middleware: config.middleware ?? [],
    socketOptions: config.socketOptions ?? {},
    adapter: config.adapter,
  }
}
