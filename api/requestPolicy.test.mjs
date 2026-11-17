import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequestPolicy } from './requestPolicy.mjs'

test('CORS, CSRF, origens malformadas, JSON e limitação de login', async t => {
  const policy = createRequestPolicy({ production: true, allowedOrigins: ['https://control.example.test'] })
  const server = createServer((req, res) => {
    if (policy(req, res)) { res.writeHead(200); res.end('{}') }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = (headers = {}, method = 'POST', route = '/api/profiles') => fetch(`${base}${route}`, { method, headers })
  assert.equal((await request({ Origin: 'null' })).status, 403)
  assert.equal((await request({ Origin: 'https://evil.example.test' })).status, 403)
  assert.equal((await request({ 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await request({ 'Content-Type': 'application/json' })).status, 200)
  const allowed = await request({ Origin: 'https://control.example.test', 'Content-Type': 'application/json' })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://control.example.test')
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
  assert.equal((await request({ Origin: 'https://control.example.test' }, 'OPTIONS')).status, 204)
  assert.equal((await request({ Origin: 'https://evil.example.test' }, 'OPTIONS')).status, 403)
  for (let i = 0; i < 20; i++) assert.equal((await request({ 'Content-Type': 'application/json' }, 'POST', '/api/auth/login')).status, 200)
  assert.equal((await request({ 'Content-Type': 'application/json' }, 'POST', '/api/auth/login')).status, 429)
})
