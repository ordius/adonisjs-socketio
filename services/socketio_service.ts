import app from '@adonisjs/core/services/app'
import type { SocketIoManager } from '../src/socketio_manager.js'

let socketio: SocketIoManager

await app.booted(async () => {
  socketio = await app.container.make('socketio')
})

export { socketio as default }
