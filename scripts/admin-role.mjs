import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'

const [action, email, confirmation] = process.argv.slice(2)
if (!['grant', 'revoke'].includes(action) || !email || confirmation !== '--confirm') {
  throw new Error('Uso: pnpm admin:role <grant|revoke> <email-da-conta-existente> --confirm')
}
const pool = createDatabasePool(readConfig(loadEnvironment()))
let connection
try {
  connection = await pool.getConnection()
  await connection.beginTransaction()
  const rows = await connection.query('SELECT id FROM users WHERE email = ? AND status = ? FOR UPDATE', [email.trim().toLowerCase(), 'active'])
  if (rows.length !== 1) throw new Error('Conta ativa não encontrada.')
  await connection.query('UPDATE users SET role = ? WHERE id = ?', [action === 'grant' ? 'admin' : 'user', rows[0].id])
  await connection.query('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL', [rows[0].id])
  await connection.commit()
  console.log('Privilégio atualizado. As sessões anteriores foram revogadas; entre novamente.')
} catch (error) {
  if (connection) await connection.rollback()
  console.error('[admin:role] Falha ao provisionar.', error.code || error.message)
  process.exitCode = 1
} finally {
  connection?.release()
  await pool.end()
}
