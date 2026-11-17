import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createTestApi } from './testSupport.mjs'
import { loadEnvironment } from '../config/environment.mjs'
import { createApi } from '../build/backend/api/localApi.js'

test('API independente: autenticação, perfis, autorização e isolamento real MariaDB', { timeout: 60_000 }, async t => {
  const fixture = await createTestApi()
  t.after(() => fixture.close())
  const { base, pool } = fixture
  const first = await fixture.account()
  const second = await fixture.account()
  const admin = await fixture.account('admin')
  const firstLogin = await fixture.login(first)
  const secondLogin = await fixture.login(second)
  const adminLogin = await fixture.login(admin)
  let createdProfile
  const request = (route, { cookie = firstLogin.cookie, method = 'GET', body, headers = {} } = {}) =>
    fetch(`${base}${route}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  await t.test('conexão, cookie HttpOnly, SameSite, token somente como hash e sessão', async () => {
    assert.equal((await request('/api/health')).status, 200)
    const cookieHeader = firstLogin.response.headers.get('set-cookie')
    assert.match(cookieHeader, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=1209600/)
    assert.equal(firstLogin.data.user.id, first.id)
    assert.equal(firstLogin.data.user.role, 'user')
    const response = await request('/api/auth/session')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.id, first.id)
    const raw = firstLogin.cookie.split('=')[1]
    const [session] = await pool.query('SELECT token_hash FROM user_sessions WHERE user_id = ?', [first.id])
    assert.deepEqual(session.token_hash, createHash('sha256').update(raw).digest())
  })

  await t.test('login da conta local existente configurada no ambiente', async context => {
    const env = loadEnvironment()
    if (!env.KIDSPLAY_TEST_USER_EMAIL || !env.KIDSPLAY_TEST_USER_PASSWORD) {
      context.skip('Conta de teste existente não configurada; nenhuma senha foi solicitada ou alterada.')
      return
    }
    const login = await fixture.login({ email: env.KIDSPLAY_TEST_USER_EMAIL, password: env.KIDSPLAY_TEST_USER_PASSWORD })
    const response = await request('/api/auth/logout', { cookie: login.cookie, method: 'POST', body: {} })
    assert.equal(response.status, 204)
  })

  await t.test('criação, consulta, edição e isolamento de perfis', async () => {
    const created = await request('/api/profiles', { method: 'POST', body: { name: 'Perfil temporário Fase B', avatar: 'rocket' } })
    assert.equal(created.status, 201)
    createdProfile = (await created.json()).id
    assert.equal((await (await request('/api/profiles')).json()).some(profile => profile.id === createdProfile), true)
    assert.equal((await (await request('/api/profiles', { cookie: secondLogin.cookie })).json()).some(profile => profile.id === createdProfile), false)
    assert.equal((await request(`/api/profiles/${createdProfile}`, { cookie: secondLogin.cookie, method: 'PUT', body: { name: 'Não alterar' } })).status, 404)
    assert.equal((await request(`/api/profiles/${createdProfile}`, { cookie: secondLogin.cookie, method: 'DELETE' })).status, 404)
    const updated = await request(`/api/profiles/${createdProfile}`, { method: 'PUT', body: { name: 'Nome editado', avatar: 'cat' } })
    assert.equal(updated.status, 200)
    assert.equal((await updated.json()).avatar, 'cat')
    assert.equal((await request('/api/profiles', { cookie: '' })).status, 401)
  })

  await t.test('catálogo mantém contrato do streaming e não divulga credenciais', async () => {
    const response = await request('/api/catalog', { cookie: '' })
    assert.equal(response.status, 200)
    const catalog = await response.json()
    assert.ok(Array.isArray(catalog))
    for (const title of catalog) {
      assert.equal(typeof title.id, 'number')
      assert.equal(typeof title.title, 'string')
      assert.ok(Array.isArray(title.tags))
      assert.ok(Array.isArray(title.episodes))
      for (const episode of title.episodes) assert.equal(typeof episode.file, 'string')
    }
    assert.ok(!JSON.stringify(catalog).includes('password_hash'))
  })

  await t.test('todas as famílias administrativas exigem sessão e papel admin', async () => {
    for (const route of ['/status', '/catalog', '/catalog/tags', '/accounts', '/media-processing/jobs']) {
      assert.equal((await request(`/api/admin${route}`, { cookie: '' })).status, 401, route)
      assert.equal((await request(`/api/admin${route}`)).status, 403, route)
      assert.equal((await request(`/api/admin${route}`, { cookie: adminLogin.cookie })).status, 200, route)
    }
    for (const route of ['/catalog/titles', '/catalog/seasons', '/catalog/episodes', '/catalog/assets', '/catalog/tags', '/accounts', '/media-processing/pending']) {
      assert.equal((await request(`/api/admin${route}`, { method: 'POST', body: {} })).status, 403, route)
    }
    assert.equal((await request('/api/admin/accounts', { cookie: adminLogin.cookie, method: 'POST', body: { role: 'admin' } })).status, 400)
    assert.equal((await request(`/api/admin/accounts/${first.id}`, { cookie: adminLogin.cookie, method: 'PUT', body: { role: 'admin' } })).status, 400)
    assert.equal((await request('/api/admin/accounts', { cookie: firstLogin.cookie, method: 'POST', body: { role: 'admin' } })).status, 403)
    assert.equal((await request('/api/accounts')).status, 404)
  })

  await t.test('API administrativa cria, consulta e edita títulos, temporadas e episódios', async () => {
    let titleId
    let seasonId
    let episodeId
    const slug = `kidsplay-admin-${randomUUID()}`
    try {
      const titleResponse = await request('/api/admin/catalog/titles', {
        cookie: adminLogin.cookie,
        method: 'POST',
        body: { name: 'Título temporário Admin', slug, status: 'draft' },
      })
      assert.equal(titleResponse.status, 201)
      titleId = (await titleResponse.json()).id

      const titleUpdate = await request(`/api/admin/catalog/titles/${titleId}`, {
        cookie: adminLogin.cookie,
        method: 'PUT',
        body: { name: 'Título editado Admin', slug, description: 'Atualizado', status: 'draft' },
      })
      assert.equal(titleUpdate.status, 200)

      const seasonResponse = await request('/api/admin/catalog/seasons', {
        cookie: adminLogin.cookie,
        method: 'POST',
        body: { titleId, number: 1, name: 'Temporada temporária', status: 'draft' },
      })
      assert.equal(seasonResponse.status, 201)
      seasonId = (await seasonResponse.json()).id

      const seasonUpdate = await request(`/api/admin/catalog/seasons/${seasonId}`, {
        cookie: adminLogin.cookie,
        method: 'PUT',
        body: { titleId, number: 1, name: 'Temporada editada', status: 'draft' },
      })
      assert.equal(seasonUpdate.status, 200)

      const episodeResponse = await request('/api/admin/catalog/episodes', {
        cookie: adminLogin.cookie,
        method: 'POST',
        body: { seasonId, number: 1, name: 'Episódio temporário', durationSeconds: 60, status: 'draft' },
      })
      assert.equal(episodeResponse.status, 201)
      episodeId = (await episodeResponse.json()).id

      const episodeUpdate = await request(`/api/admin/catalog/episodes/${episodeId}`, {
        cookie: adminLogin.cookie,
        method: 'PUT',
        body: { seasonId, number: 1, name: 'Episódio editado', durationSeconds: 90, status: 'draft' },
      })
      assert.equal(episodeUpdate.status, 200)

      const catalogResponse = await request('/api/admin/catalog', { cookie: adminLogin.cookie })
      assert.equal(catalogResponse.status, 200)
      const catalog = await catalogResponse.json()
      const title = catalog.find(item => item.id === titleId)
      assert.equal(title?.name, 'Título editado Admin')
      assert.equal(title?.seasons[0]?.name, 'Temporada editada')
      assert.equal(title?.seasons[0]?.episodes[0]?.name, 'Episódio editado')
      assert.equal(title?.seasons[0]?.episodes[0]?.durationSeconds, 90)
    } finally {
      if (episodeId) await pool.query('DELETE FROM episodes WHERE id = ?', [episodeId])
      if (seasonId) await pool.query('DELETE FROM seasons WHERE id = ?', [seasonId])
      if (titleId) await pool.query('DELETE FROM titles WHERE id = ?', [titleId])
    }
  })

  await t.test('cadastro administrativo cria somente usuário comum por padrão', async () => {
    const response = await request('/api/admin/accounts', {
      cookie: adminLogin.cookie, method: 'POST',
      body: { name: 'Conta temporária', email: `test-${randomUUID()}@example.test`, password: first.password, status: 'active' },
    })
    assert.equal(response.status, 201)
    const { id } = await response.json()
    try {
      const [row] = await pool.query('SELECT role FROM users WHERE id = ?', [id])
      assert.equal(row.role, 'user')
    } finally { await pool.query('DELETE FROM users WHERE id = ?', [id]) }
  })

  await t.test('CLI provisiona somente conta explícita e revoga suas sessões', async () => {
    const provisioned = await fixture.account()
    const previous = await fixture.login(provisioned)
    execFileSync(process.execPath, ['scripts/admin-role.mjs', 'grant', provisioned.email, '--confirm'], { stdio: 'pipe' })
    assert.equal((await request('/api/auth/session', { cookie: previous.cookie })).status, 401)
    const elevated = await fixture.login(provisioned)
    assert.equal(elevated.data.user.role, 'admin')
    assert.equal((await request('/api/admin/accounts', { cookie: elevated.cookie })).status, 200)
    execFileSync(process.execPath, ['scripts/admin-role.mjs', 'revoke', provisioned.email, '--confirm'], { stdio: 'pipe' })
    assert.equal((await request('/api/admin/accounts', { cookie: elevated.cookie })).status, 401)
  })

  await t.test('origem hostil, JSON inválido e cookie malformado são tratados', async () => {
    assert.equal((await request('/api/profiles', { headers: { Origin: 'null' } })).status, 403)
    assert.equal((await request('/api/profiles', { headers: { Origin: 'https://other.invalid' } })).status, 403)
    assert.equal((await request('/api/auth/session', { cookie: 'kidsplay_session=%zz' })).status, 401)
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    assert.equal((await request('/api/auth/login', { cookie: '', method: 'POST', body: { email: first.email, password: 'incorreta' } })).status, 401)
    const allowed = await request('/api/profiles', { headers: { Origin: 'http://localhost:8443' } })
    if (fixture.config.api.allowedOrigins.includes('http://localhost:8443')) {
      assert.equal(allowed.status, 200)
      assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
    } else assert.equal(allowed.status, 403)
  })

  await t.test('remoção de perfil não afeta outros registros', async () => {
    assert.equal((await request(`/api/profiles/${createdProfile}`, { method: 'DELETE' })).status, 204)
    assert.equal((await request(`/api/profiles/${createdProfile}`, { method: 'DELETE' })).status, 404)
    const [preferences] = await pool.query('SELECT COUNT(*) AS count FROM profile_preferences WHERE profile_id = ?', [createdProfile])
    assert.equal(Number(preferences.count), 0)
  })

  await t.test('privilégio é verificado a cada requisição, sem confiar no cookie ou no renderer', async () => {
    await pool.query("UPDATE users SET role = 'user' WHERE id = ?", [admin.id])
    assert.equal((await request('/api/admin/accounts', { cookie: adminLogin.cookie })).status, 403)
  })

  await t.test('sessão expirada, conta suspensa e logout revogado', async () => {
    await pool.query('UPDATE user_sessions SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE user_id = ?', [second.id])
    assert.equal((await request('/api/auth/session', { cookie: secondLogin.cookie })).status, 401)
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = ?", [admin.id])
    assert.equal((await request('/api/auth/session', { cookie: adminLogin.cookie })).status, 401)
    const logout = await request('/api/auth/logout', { method: 'POST', body: {} })
    assert.equal(logout.status, 204)
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
    assert.equal((await request('/api/auth/session')).status, 401)
  })
})

test('Controle legado mantém contratos mas exige login administrativo', async t => {
  const fixture = await createTestApi({ legacyAdmin: true })
  t.after(() => fixture.close())
  const account = await fixture.account('admin')
  const { cookie } = await fixture.login(account)
  assert.equal((await fetch(`${fixture.base}/`)).status, 200)
  assert.equal((await fetch(`${fixture.base}/api/catalog`)).status, 401)
  assert.equal((await fetch(`${fixture.base}/api/catalog`, { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await fetch(`${fixture.base}/api/status`, { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await fetch(`${fixture.base}/api/auth/session`, { headers: { Cookie: cookie } })).status, 200)
})

test('produção emite cookie Secure no login e no logout', async t => {
  const fixture = await createTestApi()
  t.after(() => fixture.close())
  const account = await fixture.account()
  const secureApi = createApi({ ...fixture.config, api: { ...fixture.config.api, secureCookies: true } }, fixture.pool)
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const server = createServer((req, res) => void secureApi.handle(req, res, () => res.end()))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /; Secure/)
  const cookie = response.headers.get('set-cookie').split(';')[0]
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } })
  assert.match(logout.headers.get('set-cookie'), /; Secure/)
})

test('falha no banco durante logout retorna 503 e preserva o cookie para nova tentativa', async t => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { readConfig } = await import('../config/environment.mjs')
  const api = createApi(readConfig(loadEnvironment()), { query: async () => { throw new Error('Falha simulada de conexão') } })
  const server = createServer((req, res) => void api.handle(req, res, () => res.end()))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections() }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: `kidsplay_session=${'a'.repeat(43)}` },
  })
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('set-cookie'), null)
})
