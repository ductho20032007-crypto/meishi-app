// src/services/db.js
import Dexie from 'dexie'
export function openDb(name = 'meishi') {
  const db = new Dexie(name)
  db.version(1).stores({
    cards: 'id, companyId, status, updatedAt',
    companies: 'id',
    images: 'path',              // { path, blob }
    files: 'path',               // { path, sha, base }  last synced state
    outbox: '++seq, &path',      // { seq, path, op: 'put'|'delete', state: 'ready'|'conflict' }
    conflicts: 'path',           // { path, local, remote, remoteSha, fields }
    meta: 'key'                  // { key, value }
  })
  return db
}
export const db = openDb()
