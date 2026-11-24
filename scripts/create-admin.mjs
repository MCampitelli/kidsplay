import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'
import { hashPassword } from '../api/passwords.mjs'

// Cria uma conta administradora a partir do .env local.
// A senha nunca é exibida nem passada por linha de comando.
const env = loadEnvironment()

function required(name) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Configure ${name} no .env local antes de executar.`)
  return value
}

const name = required('KIDSPLAY_ADMIN_NAME')
const email = required('KIDSPLAY_ADMIN_EMAIL').toLowerCase()
const password = required('KIDSPLAY_ADMIN_PASSWORD')
if (password.length < 12) throw new Error('KIDSPLAY_ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('KIDSPLAY_ADMIN_EMAIL não parece válido.')

const pool = createDatabasePool(readConfig(env))
let connection
try {
  connection = await pool.getConnection()
  await connection.beginTransaction()
  const existing = await connection.query('SELECT id FROM users WHERE email = ? FOR UPDATE', [email])
  if (existing.length > 0) {
    throw new Error('Já existe uma conta com esse e-mail; nada foi alterado. Use pnpm admin:role para promovê-la.')
  }
  await connection.query(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified_at)
     VALUES (?, ?, ?, 'admin', 'active', CURRENT_TIMESTAMP(3))`,
    [name, email, await hashPassword(password)],
  )
  await connection.commit()
  console.log(`Conta admin criada: ${email}`)
  console.log('A senha é KIDSPLAY_ADMIN_PASSWORD do .env local; ela não foi exibida.')
} catch (error) {
  if (connection) await connection.rollback()
  console.error('[admin:create]', error instanceof Error ? error.message : 'Falha ao criar admin.')
  process.exitCode = 1
} finally {
  connection?.release()
  await pool.end()
}
