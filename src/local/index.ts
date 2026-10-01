import { serve } from '@hono/node-server'
import app from './app.ts'
import { startOAuthServer } from './oauth-server.ts'

await startOAuthServer()
console.log('Nail Mail OAuth: http://localhost:8766/')

serve({ fetch: app.fetch, port: 8767, hostname: '127.0.0.1' }, info => {
  console.log(`Nail Mail local API: http://127.0.0.1:${info.port}`)
})
