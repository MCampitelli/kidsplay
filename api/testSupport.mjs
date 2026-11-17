import { randomUUID, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'
import { createApiServer } from '../build/backend/api/httpServer.js'
import { hashPassword } from './passwords.mjs'

export async function createTestApi({ legacyAdmin = false } = {}) {
  const config = readConfig(loadEnvironment())
  const pool = createDatabasePool(config)
  const users = []
  const app = createApiServer(config, pool, legacyAdmin)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const port = app.server.address().port
  config.adminPort = port
  const base = `http://127.0.0.1:${port}`
  async function account(role = 'user', status = 'active') {
    const email = `test-${randomUUID()}@example.test`
    const password = randomBytes(24).toString('base64url')
    const result = await pool.query('INSERT INTO users (name, email, password_hash, status, role) VALUES (?, ?, ?, ?, ?)',
      ['Fixture Fase B', email, await hashPassword(password), status, role])
    const id = Number(result.insertId)
    users.push(id)
    return { id, email, password }
  }
  async function login(account) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password: account.password }),
    })
    if (response.status !== 200) throw new Error(`Login de teste falhou: HTTP ${response.status}.`)
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    return { cookie, response, data: await response.json() }
  }
  async function close() {
    await new Promise((resolve, reject) => {
      app.server.close(error => error ? reject(error) : resolve())
      app.server.closeIdleConnections()
    })
    try {
      for (const id of users) await pool.query('DELETE FROM users WHERE id = ?', [id])
    } finally { await pool.end() }
  }
  return { config, pool, app, base, account, login, close }
}
