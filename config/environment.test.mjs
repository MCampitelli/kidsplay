import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadEnvironment, readConfig, readApiTarget } from './environment.mjs'

const valid = { KIDSPLAY_ENV: 'development', KIDSPLAY_DB_USER: 'fixture', KIDSPLAY_DB_PASSWORD: '' }

test('configuração preserva defaults e valida campos sem revelar valores', () => {
  const config = readConfig(valid)
  assert.equal(config.database.host, '127.0.0.1')
  assert.equal(config.database.port, 3306)
  assert.equal(config.database.database, 'kidsplay_db')
  assert.equal(config.api.secureCookies, false)
  for (const value of ['abc', '3306oops', '0', '65536', '3.5']) {
    assert.throws(() => readConfig({ ...valid, KIDSPLAY_DB_PORT: value }), /KIDSPLAY_DB_PORT/)
  }
  assert.throws(() => readConfig({ ...valid, KIDSPLAY_DB_USER: '' }), /KIDSPLAY_DB_USER/)
  assert.throws(() => readConfig({ ...valid, KIDSPLAY_DB_PASSWORD: undefined }), /KIDSPLAY_DB_PASSWORD/)
  assert.throws(() => readConfig({ ...valid, KIDSPLAY_COOKIE_SECURE: 'yes' }), /KIDSPLAY_COOKIE_SECURE/)
})

test('produção exige cookie seguro e origens HTTPS explícitas', () => {
  const production = { ...valid, KIDSPLAY_ENV: 'production', KIDSPLAY_DB_PASSWORD: 'illustrative', KIDSPLAY_ALLOWED_ORIGINS: 'https://example.test' }
  assert.equal(readConfig(production).api.secureCookies, true)
  assert.throws(() => readConfig({ ...production, KIDSPLAY_COOKIE_SECURE: 'false' }), /HTTPS/)
  assert.throws(() => readConfig({ ...production, KIDSPLAY_ALLOWED_ORIGINS: '*' }), /origem/)
  assert.throws(() => readConfig({ ...production, KIDSPLAY_ALLOWED_ORIGINS: 'http://example.test' }), /HTTPS/)
  assert.throws(() => readApiTarget({ KIDSPLAY_API_TARGET: 'https://user:password@example.test' }), /somente/)
  assert.equal(readApiTarget({ KIDSPLAY_API_TARGET: 'http://localhost:8788' }), 'http://localhost:8788')
})

test('ambientes têm precedência e não modificam process.env', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kidsplay-config-'))
  const key = 'KIDSPLAY_CONFIG_TEST_PRECEDENCE'
  const before = process.env[key]
  try {
    writeFileSync(path.join(root, '.env'), `${key}=base\nKIDSPLAY_CONFIG_TEST_BASE=base`)
    writeFileSync(path.join(root, '.env.local'), `${key}=local`)
    writeFileSync(path.join(root, '.env.production'), `${key}=production`)
    writeFileSync(path.join(root, '.env.production.local'), `${key}=production-local`)
    assert.equal(loadEnvironment('production', root)[key], before ?? 'production-local')
    assert.equal(loadEnvironment('development', root)[key], before ?? 'local')
    assert.equal(process.env[key], before)
    assert.equal(process.env.KIDSPLAY_CONFIG_TEST_BASE, undefined)
  } finally { rmSync(root, { recursive: true }) }
})
