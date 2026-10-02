import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openClassificationDb } from './classification-db.ts'

test('legacy classifications and sender rules migrate once, then use SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nail-classifications-'))
  const dbPath = join(directory, 'nail.sqlite')
  const classificationsPath = join(directory, '.classifications.json')
  const rulesPath = join(directory, '.classification-rules.json')
  try {
    writeFileSync(classificationsPath, JSON.stringify({ existing: '配送' }))
    writeFileSync(rulesPath, JSON.stringify([{ email: 'shop@example.test', category: 'ショッピング', after: 1000 }]))
    let db = openClassificationDb(dbPath, classificationsPath, rulesPath)
    assert.deepEqual(db.readClassifications(), { existing: '配送' })
    assert.deepEqual(db.readSenderRules(), [{ email: 'shop@example.test', category: 'ショッピング', after: 1000 }])
    assert.deepEqual(db.setClassification('existing', 'ショッピング'), { existing: 'ショッピング' })
    db.addSenderRule({ email: 'store@example.test', category: '予約', subjectContains: '確定', after: 2000 })
    db.close()

    db = openClassificationDb(dbPath, classificationsPath, rulesPath)
    assert.deepEqual(db.readClassifications(), { existing: 'ショッピング' })
    assert.deepEqual(db.readSenderRules(), [
      { email: 'shop@example.test', category: 'ショッピング', after: 1000 },
      { email: 'store@example.test', category: '予約', subjectContains: '確定', after: 2000 },
    ])
    db.close()
    assert.deepEqual(JSON.parse(readFileSync(classificationsPath, 'utf8')), { existing: '配送' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
