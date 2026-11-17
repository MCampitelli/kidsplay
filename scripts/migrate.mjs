import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'

const pool = createDatabasePool(readConfig(loadEnvironment()))
let connection
let locked = false
try {
  connection = await pool.getConnection()
  const [lock] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':kidsplay-migrations'), 10) AS acquired")
  if (Number(lock.acquired) !== 1) throw new Error('Outra migração está em andamento.')
  locked = true
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) NOT NULL PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  for (const version of ['001-title-tags.sql', '002-user-role.sql']) {
    const sql = await readFile(new URL(`../database/migrations/${version}`, import.meta.url), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const rows = await connection.query('SELECT checksum FROM schema_migrations WHERE version = ?', [version])
    if (rows.length) {
      if (rows[0].checksum !== checksum) throw new Error(`Migração já aplicada foi modificada: ${version}.`)
      console.log(`${version}: já aplicada.`)
      continue
    }
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).filter(value => value.trim())) await connection.query(statement)
    await connection.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [version, checksum])
    console.log(`${version}: aplicada.`)
  }
} catch (error) {
  console.error('[db:migrate] Falha na migração.', error.code || error.message)
  process.exitCode = 1
} finally {
  try {
    if (locked) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':kidsplay-migrations'))")
  } finally {
    connection?.release()
    await pool.end()
  }
}
