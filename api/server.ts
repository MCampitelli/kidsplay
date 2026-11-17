import { once } from 'node:events'
import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'
import { createApiServer } from './httpServer.js'

const config = readConfig(loadEnvironment())
const legacyAdmin = process.argv.includes('--catalog-admin')
const pool = createDatabasePool(config)
const app = createApiServer(config, pool, legacyAdmin)

try {
  await pool.query('SELECT role FROM users LIMIT 0')
  await app.initialize()
  app.server.listen(legacyAdmin ? config.adminPort : config.api.port, legacyAdmin ? '127.0.0.1' : config.api.host)
  await once(app.server, 'listening')
  console.log(legacyAdmin ? `KidsPlay Controle: http://127.0.0.1:${config.adminPort}` : `KidsPlay API disponível na porta ${config.api.port}.`)
} catch {
  console.error('[kidsplay-api] Não foi possível iniciar. Confira a configuração, a porta e execute db:migrate.')
  await app.close()
  await pool.end()
  process.exitCode = 1
}

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  const closed = new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()))
  app.server.closeIdleConnections()
  await app.close()
  await closed
  await pool.end()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown().catch(() => {
    console.error('[kidsplay-api] Falha ao encerrar o serviço.')
    process.exitCode = 1
  }))
}
