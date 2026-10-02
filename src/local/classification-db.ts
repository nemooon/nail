import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Category, Classifications, SenderRule } from './classifications.ts'

const schemaPath = resolve(import.meta.dirname, '../../migrations/0001_init.sql')

function readLegacy<T>(path: string, empty: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
    throw error
  }
}

export function openClassificationDb(dbPath: string, legacyClassificationsPath: string, legacyRulesPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  try {
    chmodSync(dbPath, 0o600)
    db.exec(readFileSync(schemaPath, 'utf8'))

    const imported = db.prepare('SELECT value FROM app_state WHERE key = ?').get('local_classification_json_imported')
    if (!imported) {
      const classifications = readLegacy<Classifications>(legacyClassificationsPath, {})
      const rules = readLegacy<SenderRule[]>(legacyRulesPath, [])
      db.exec('BEGIN IMMEDIATE')
      try {
        const insertClassification = db.prepare('INSERT INTO classifications (message_id, category) VALUES (?, ?) ON CONFLICT(message_id) DO NOTHING')
        for (const [id, category] of Object.entries(classifications)) insertClassification.run(id, category)
        const insertRule = db.prepare('INSERT INTO sender_rules (email, category, subject_contains, after_ms) VALUES (?, ?, ?, ?)')
        for (const rule of rules) insertRule.run(rule.email, rule.category, rule.subjectContains ?? null, rule.after)
        db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run('local_classification_json_imported', '1')
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }

    return {
      readClassifications(): Classifications {
        return Object.fromEntries(db.prepare('SELECT message_id, category FROM classifications').all()
          .map(row => [row.message_id as string, row.category as Category]))
      },
      setClassification(id: string, category: Category): Classifications {
        db.prepare('INSERT INTO classifications (message_id, category) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET category = excluded.category').run(id, category)
        return this.readClassifications()
      },
      readSenderRules(): SenderRule[] {
        return db.prepare('SELECT email, category, subject_contains, after_ms FROM sender_rules ORDER BY id').all()
          .map(row => ({ email: row.email as string, category: row.category as Category,
            ...(row.subject_contains === null ? {} : { subjectContains: row.subject_contains as string }), after: row.after_ms as number }))
      },
      addSenderRule(rule: SenderRule): void {
        db.prepare('INSERT INTO sender_rules (email, category, subject_contains, after_ms) VALUES (?, ?, ?, ?)')
          .run(rule.email, rule.category, rule.subjectContains ?? null, rule.after)
      },
      close(): void { db.close() },
    }
  } catch (error) {
    db.close()
    throw error
  }
}
