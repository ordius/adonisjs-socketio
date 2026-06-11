import { SocketIoManager } from '../src/socketio_manager.js'
import type { ResolvedWebSocketConfig } from '../src/types.js'
import type { ApplicationService } from '@adonisjs/core/types'

declare module '@adonisjs/core/types' {
  interface ContainerBindings {
    socketio: SocketIoManager
  }
}

export default class SocketIoProvider {
  constructor(protected app: ApplicationService) {}

  public register() {
    this.app.container.singleton('socketio', () => {
      const config = this.app.config.get<ResolvedWebSocketConfig>('socketio', {
        enabled: true,
        middleware: [],
        socketOptions: {},
      })

      return new SocketIoManager(this.app, config)
    })
  }

  public async ready() {
    const config = this.app.config.get<ResolvedWebSocketConfig>('socketio')
    if (config?.enabled === false) return

    const socketio = await this.app.container.make('socketio')
    if (socketio) await socketio.boot()
  }

  public async shutdown() {
    const socketio = await this.app.container.make('socketio')
    if (socketio) await socketio.shutdown()
  }
}
