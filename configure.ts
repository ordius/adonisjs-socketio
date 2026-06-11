/*
|--------------------------------------------------------------------------
| Configure hook
|--------------------------------------------------------------------------
|
| The configure hook is called when someone runs "node ace configure <package>"
| command. You are free to perform any operations inside this function to
| configure the package.
|
| To make things easier, you have access to the underlying "Configure"
| instance and you can use codemods to modify the source files.
|
*/

import { stubsRoot } from './stubs/main.js'
import type Configure from '@adonisjs/core/commands/configure'

export async function configure(command: Configure) {
  const codemods = await command.createCodemods()
  await codemods.makeUsingStub(stubsRoot, 'config/socketio.stub', {})
  await codemods.makeUsingStub(stubsRoot, 'start/socketio.stub', {})

  await codemods.updateRcFile((rcFile) => {
    rcFile.addProvider('@ordius/adonisjs-socketio/socketio_provider')
    rcFile.addPreloadFile('#start/socketio', ['web'])
  })
}
