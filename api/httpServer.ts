import { createServer } from 'node:http'
import type { Pool } from 'mariadb'
import { createApi } from './localApi.js'
import { createCatalogAdmin } from './catalogAdmin.mjs'
import { createRequestPolicy } from './requestPolicy.mjs'
import { readConfig } from '../config/environment.mjs'

export function createApiServer(config: ReturnType<typeof readConfig>, pool: Pool, legacyAdmin = false) {
  const api = createApi(config, pool)
  const admin = createCatalogAdmin({ pool, authenticatedUser: api.authenticatedUser })
  const policy = createRequestPolicy(config.api)
  const server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if (!policy(req, res)) return
      if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
        return admin.handle(req, res, `/api${pathname.slice('/api/admin'.length)}`)
      }
      if (legacyAdmin && !pathname.startsWith('/api/auth/') && pathname !== '/api/health') {
        const validHost = [`127.0.0.1:${config.adminPort}`, `localhost:${config.adminPort}`].includes(req.headers.host ?? '')
        if (!validHost) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'A ferramenta aceita apenas conexões locais.' }))
        }
        return admin.handle(req, res)
      }
      return api.handle(req, res, () => {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Rota não encontrada.' }))
      })
    })().catch(() => {
      console.error('[kidsplay-api] unexpected request failure')
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Não foi possível processar a requisição.' }))
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  return { server, initialize: admin.initialize, close: admin.close }
}
