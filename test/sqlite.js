import { DatabaseSync } from 'node:sqlite'

/** Durable Object `ctx.storage.sql` look-alike over node:sqlite, so the real Inventory runs in tests. */
export function memorySql() {
  const db = new DatabaseSync(':memory:')
  return {
    exec(query, ...binds) {
      const rows = db.prepare(query).all(...binds)
      return { toArray: () => rows, one: () => rows[0] }
    },
  }
}
