import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAdminRequest, validateAdminApiOrigin, validateAdminRequestPayload } from './apiPolicy.mjs'

test('mapeia apenas as rotas administrativas suportadas', () => {
  const allowed = [
    ['/api/auth/login', 'POST', '/api/auth/login'],
    ['/api/auth/session', 'GET', '/api/auth/session'],
    ['/api/auth/logout', 'POST', '/api/auth/logout'],
    ['/api/health', 'GET', '/api/health'],
    ['/api/status', 'GET', '/api/admin/status'],
    ['/api/catalog', 'GET', '/api/admin/catalog'],
    ['/api/catalog/tags', 'GET', '/api/admin/catalog/tags'],
    ['/api/catalog/tags', 'POST', '/api/admin/catalog/tags'],
    ['/api/catalog/tags/8', 'PUT', '/api/admin/catalog/tags/8'],
    ['/api/catalog/titles', 'POST', '/api/admin/catalog/titles'],
    ['/api/catalog/titles/8', 'PUT', '/api/admin/catalog/titles/8'],
    ['/api/catalog/seasons', 'POST', '/api/admin/catalog/seasons'],
    ['/api/catalog/seasons/8', 'PUT', '/api/admin/catalog/seasons/8'],
    ['/api/catalog/episodes', 'POST', '/api/admin/catalog/episodes'],
    ['/api/catalog/episodes/8', 'PUT', '/api/admin/catalog/episodes/8'],
    ['/api/accounts', 'GET', '/api/admin/accounts'],
    ['/api/accounts', 'POST', '/api/admin/accounts'],
    ['/api/accounts/8', 'PUT', '/api/admin/accounts/8'],
    ['/api/media-processing/jobs', 'GET', '/api/admin/media-processing/jobs'],
    ['/api/media-processing/pending', 'POST', '/api/admin/media-processing/pending'],
    ['/api/media-processing/episodes/42', 'POST', '/api/admin/media-processing/episodes/42'],
    ['/api/media-processing/episodes/42/retry', 'POST', '/api/admin/media-processing/episodes/42/retry'],
  ]
  for (const [path, method, adminPath] of allowed) {
    assert.deepEqual(resolveAdminRequest(path, method), { path: adminPath, method }, `${method} ${path}`)
  }
  for (const [path, method] of [
    ['/api/users', 'GET'], ['/api/admin/accounts', 'GET'], ['/api/accounts/1', 'DELETE'],
    ['/api/auth/login', 'GET'], ['/api/auth/session', 'POST'],
    ['/api/catalog/titles', 'GET'], ['/api/catalog/tags/1', 'POST'],
    ['/api/catalog/seasons/1', 'DELETE'], ['/api/catalog/episodes/1', 'DELETE'],
    ['/api/catalog/titles/1', 'DELETE'], ['/api/accounts/1', 'DELETE'],
    ['/api/media-processing/episodes/1', 'PUT'], ['/api/media-processing/jobs', 'POST'],
    ['/api/catalog/../../auth/logout', 'POST'], ['/api/catalog/%2e%2e/auth/logout', 'POST'],
    ['https://evil.invalid/api/auth/login', 'POST'], ['/api//auth/login', 'POST'],
  ]) assert.equal(resolveAdminRequest(path, method), null, `${method} ${path}`)
})

test('rejeita origem não segura, credenciais e parâmetros', () => {
  assert.equal(validateAdminApiOrigin('https://api.example.test'), 'https://api.example.test')
  assert.equal(validateAdminApiOrigin('http://127.0.0.1:8788', { production: false }), 'http://127.0.0.1:8788')
  assert.throws(() => validateAdminApiOrigin('http://api.example.test', { production: false }), /HTTPS/)
  assert.throws(() => validateAdminApiOrigin('http://127.0.0.1:8788'), /HTTPS/)
  assert.throws(() => validateAdminApiOrigin('https://user:pass@api.example.test'), /somente a origem/)
  assert.throws(() => validateAdminApiOrigin('https://api.example.test/path'), /somente a origem/)
  assert.throws(() => validateAdminApiOrigin('file:///etc/passwd'), /URL da API/)
})

test('valida o payload IPC antes da requisição', () => {
  assert.deepEqual(validateAdminRequestPayload({ path: '/api/auth/login', method: 'POST', body: '{"email":"x@example.test","password":"one"}' }), {
    path: '/api/auth/login', method: 'POST', body: '{"email":"x@example.test","password":"one"}',
  })
  assert.throws(() => validateAdminRequestPayload({ path: '/api/catalog', method: 'GET', body: '{}' }), /não aceitam/)
  assert.throws(() => validateAdminRequestPayload({ path: '/api/auth/login', method: 'POST', body: '{' }), /JSON válido/)
  assert.throws(() => validateAdminRequestPayload({ path: '/api/auth/login', method: 'POST', body: '[]' }), /objeto JSON/)
  assert.throws(() => validateAdminRequestPayload({ path: '/api/auth/login', method: 'POST', body: 'x'.repeat(64_001) }), /limite/)
})
