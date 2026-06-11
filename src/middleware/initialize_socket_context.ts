import { ServerResponse } from 'node:http'
import app from '@adonisjs/core/services/app'
import server from '@adonisjs/core/services/server'

import type { SocketIoMiddleware } from '../types.js'
import type { HttpContext } from '@adonisjs/core/http'

declare module 'socket.io' {
  interface Socket {
    context?: HttpContext
  }
}

export default async function InitializeSocketContext(
  socket: Parameters<SocketIoMiddleware>[0],
  next: Parameters<SocketIoMiddleware>[1]
) {
  try {
    const response = new ServerResponse(socket.request)

    const context = server.createHttpContext(
      server.createRequest(socket.request, response),
      server.createResponse(socket.request, response),
      app.container.createResolver()
    )

    socket.context = context

    next()
  } catch (error) {
    next(error as Error)
  }
}
