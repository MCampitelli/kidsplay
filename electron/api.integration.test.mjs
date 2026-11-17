import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTestApi } from '../api/testSupport.mjs'

const require = createRequire(import.meta.url)
const electronBinary = require('electron')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function runElectronSmoke(environment, suppliedUserData) {
  const userData = suppliedUserData || mkdtempSync(path.join(os.tmpdir(), 'kidsplay-admin-electron-'))
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(electronBinary, [
      projectRoot,
      '--smoke-test',
      `--user-data-dir=${userData}`,
      ], {
        cwd: projectRoot,
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
      }, 60_000)
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
      child.once('error', reject)
      child.once('close', (status, signal) => {
        clearTimeout(timeout)
        resolve({ status, signal, stdout, stderr, timedOut })
      })
    })
  } finally {
    if (!suppliedUserData) rmSync(userData, { recursive: true, force: true })
  }
}

test('Electron usa a sessão compartilhada e respeita a autorização administrativa', { timeout: 180_000 }, async t => {
  const fixture = await createTestApi()
  t.after(() => fixture.close())

  await t.test('login admin, cookie de sessão, catálogo, tags e logout via IPC', async () => {
    const account = await fixture.account('admin')
    const mutationSlug = `electron-audit-${randomUUID()}`
    try {
      const result = await runElectronSmoke({
        KIDSPLAY_ADMIN_API_URL: fixture.base,
        KIDSPLAY_ELECTRON_SMOKE_EMAIL: account.email,
        KIDSPLAY_ELECTRON_SMOKE_PASSWORD: account.password,
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: 'admin',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: '',
        KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: mutationSlug,
      })
      assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /KIDSPLAY_ELECTRON_READY admin-api-session-and-crud-ready/, `${result.stdout}\n${result.stderr}`)
    } finally {
      await fixture.pool.query(
        'DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)',
        [`${mutationSlug}@example.test`],
      )
      await fixture.pool.query('DELETE FROM users WHERE email = ?', [`${mutationSlug}@example.test`])
      await fixture.pool.query(
        `DELETE FROM episodes WHERE season_id IN
         (SELECT id FROM seasons WHERE title_id IN (SELECT id FROM titles WHERE slug = ?))`,
        [mutationSlug],
      )
      await fixture.pool.query('DELETE FROM seasons WHERE title_id IN (SELECT id FROM titles WHERE slug = ?)', [mutationSlug])
      await fixture.pool.query('DELETE FROM title_tag_relations WHERE title_id IN (SELECT id FROM titles WHERE slug = ?)', [mutationSlug])
      await fixture.pool.query('DELETE FROM titles WHERE slug = ?', [mutationSlug])
      await fixture.pool.query('DELETE FROM title_tags WHERE slug = ?', [`${mutationSlug}-editada`])
    }
  })

  await t.test('login de usuário comum é recusado antes de operações administrativas', async () => {
    const account = await fixture.account('user')
    const result = await runElectronSmoke({
      KIDSPLAY_ADMIN_API_URL: fixture.base,
      KIDSPLAY_ELECTRON_SMOKE_EMAIL: account.email,
      KIDSPLAY_ELECTRON_SMOKE_PASSWORD: account.password,
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: 'user',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: '',
      KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: '',
      KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: '',
      KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: '',
    })
    assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /KIDSPLAY_ELECTRON_READY non-admin-rejected/, `${result.stdout}\n${result.stderr}`)
  })

  await t.test('indisponibilidade da API produz erro compreensível pelo bridge', async () => {
    const result = await runElectronSmoke({
      KIDSPLAY_ADMIN_API_URL: 'http://127.0.0.1:1',
      KIDSPLAY_ELECTRON_SMOKE_EMAIL: '',
      KIDSPLAY_ELECTRON_SMOKE_PASSWORD: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: 'true',
      KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: '',
      KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: '',
      KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: '',
      KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: '',
    })
    assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /KIDSPLAY_ELECTRON_READY api-unavailable-handled/, `${result.stdout}\n${result.stderr}`)
  })

  await t.test('recursos file:// e configuração da API persistem entre inicializações', async () => {
    const userData = mkdtempSync(path.join(os.tmpdir(), 'kidsplay-admin-electron-config-'))
    const apiBaseUrl = 'http://127.0.0.1:8799'
    try {
      const saved = await runElectronSmoke({
        KIDSPLAY_ADMIN_API_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EMAIL: '',
        KIDSPLAY_ELECTRON_SMOKE_PASSWORD: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: apiBaseUrl,
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN: 'http://127.0.0.1:8800',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: '',
        KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: '',
      }, userData)
      assert.equal(saved.timedOut, false, `${saved.stdout}\n${saved.stderr}`)
      assert.equal(saved.status, 0, `${saved.stdout}\n${saved.stderr}`)
      assert.match(saved.stdout, /KIDSPLAY_ELECTRON_READY backend-config-persisted/, `${saved.stdout}\n${saved.stderr}`)

      const restored = await runElectronSmoke({
        KIDSPLAY_ADMIN_API_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EMAIL: '',
        KIDSPLAY_ELECTRON_SMOKE_PASSWORD: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: 'http://127.0.0.1:8800',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: '',
        KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: '',
      }, userData)
      assert.equal(restored.timedOut, false, `${restored.stdout}\n${restored.stderr}`)
      assert.equal(restored.status, 0, `${restored.stdout}\n${restored.stderr}`)
      assert.match(restored.stdout, /KIDSPLAY_ELECTRON_READY backend-config-restored/, `${restored.stdout}\n${restored.stderr}`)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  await t.test('redirect HTTP da origem configurada é recusado sem seguir para outro host/porta', async () => {
    let redirectedRequest = false
    let cookieReceivedByApi = false
    const receiver = createServer((_request, response) => {
      redirectedRequest = true
      response.writeHead(204).end()
    })
    receiver.listen(0, '127.0.0.1')
    await once(receiver, 'listening')
    const receiverUrl = `http://127.0.0.1:${receiver.address().port}/captured`
    const redirector = createServer((request, response) => {
      if (request.url === '/api/auth/login') {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'kidsplay_session=smoke-session; HttpOnly; SameSite=Strict; Path=/',
        }).end(JSON.stringify({ user: { id: 1, role: 'admin' } }))
        return
      }
      if (request.url === '/api/health') {
        cookieReceivedByApi = Boolean(request.headers.cookie)
        response.writeHead(302, { Location: receiverUrl }).end()
        return
      }
      response.writeHead(404).end()
    })
    redirector.listen(0, '127.0.0.1')
    await once(redirector, 'listening')
    try {
      const result = await runElectronSmoke({
        KIDSPLAY_ADMIN_API_URL: `http://127.0.0.1:${redirector.address().port}`,
        KIDSPLAY_ELECTRON_SMOKE_EMAIL: 'smoke@example.test',
        KIDSPLAY_ELECTRON_SMOKE_PASSWORD: 'smoke-password',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE: 'admin',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL: '',
        KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED: 'true',
        KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG: '',
      })
      assert.equal(result.timedOut, false, `${result.stdout}\n${result.stderr}`)
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /KIDSPLAY_ELECTRON_READY redirect-rejected/, `${result.stdout}\n${result.stderr}`)
      assert.equal(cookieReceivedByApi, true, 'authenticated API request did not carry its session cookie')
      assert.equal(redirectedRequest, false, 'redirect destination received a request')
    } finally {
      await Promise.all([
        new Promise((resolve, reject) => receiver.close(error => error ? reject(error) : resolve())),
        new Promise((resolve, reject) => redirector.close(error => error ? reject(error) : resolve())),
      ])
    }
  })
})
