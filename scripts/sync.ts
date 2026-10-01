import { GmailClient } from '../src/gmail/gmail.ts'
import { getAccessToken, verifyOwner } from '../src/local/oauth.ts'
import { store } from '../src/local/local-store.ts'
import { sync } from '../src/gmail/sync.ts'

try {
  const token = process.env.GMAIL_ACCESS_TOKEN ?? await getAccessToken()
  await verifyOwner(token)
  const api = new GmailClient(token)
  const started = performance.now()
  try {
    const snapshot = await sync(api, store, event => {
      console.log(JSON.stringify(event))
    })
    const calls = api.calls
    console.log(JSON.stringify({
      finished: true,
      indexed: Object.keys(snapshot.messages).length,
      unread: Object.values(snapshot.messages).filter(message => message.unread).length,
      elapsedMs: Math.round(performance.now() - started),
      calls,
      estimatedQuotaUnits: calls.profile + calls.list * 5 + calls.get * 20 + calls.history * 2,
    }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
