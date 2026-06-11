/*
 * @ordius/adonisjs-socketio
 *
 * (c) Mixxtor
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import type { WebSocketRoute } from './route.ts'

/**
 * WebSocketRouteGroup manages a collection of WebSocket routes
 * and applies common operations (like prefixes) to all routes in the group.
 *
 * ```
 */
export class WebSocketRouteGroup {
  /**
   * Collection of routes in this group
   * Public to allow external access and manipulation
   */
  public readonly routes: WebSocketRoute[]

  /**
   * Create a new WebSocket route group
   *
   * @param routes - Array of WebSocketRoute instances to group together
   *
   * ```
   */
  constructor(routes: WebSocketRoute[]) {
    this.routes = routes
  }

  /**
   * Apply a prefix to all routes in the group
   * This is useful for namespacing related events
   *
   * @param prefix - String to prepend to all route patterns in the group
   * @returns Current group instance for method chaining
   *
   * @example
   * ```ts
   * // Group chat-related events
   * websocket.group(() => {
   *   websocket.on('send', handler1)
   *   websocket.on('delete', handler2)
   *   websocket.on('edit', handler3)
   * }).prefix('chat:')
   *
   * // Results in: 'chat:send', 'chat:delete', 'chat:edit'
   * ```
   *
   * @example
   * ```ts
   * // Nested prefixes
   * websocket.group(() => {
   *   websocket.group(() => {
   *     websocket.on('message', handler)
   *   }).prefix('private:')
   * }).prefix('chat:')
   *
   * // Results in: 'chat:private:message'
   * ```
   */
  prefix(prefix: string): this {
    this.routes.forEach((route) => route.prefix(prefix))
    return this
  }
}
