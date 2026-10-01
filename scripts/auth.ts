import { startOAuthServer } from '../src/local/oauth-server.ts'

await startOAuthServer({ closeAfterSuccess: true })
console.log('http://localhost:8766/ を開いて Google アカウントで認証してください。')
