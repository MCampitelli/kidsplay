import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createTestApi } from './testSupport.mjs'

// Senha provisoria (5 caracteres) e bloqueio de login, contra o MariaDB real.
test('senha provisória: criação no Controle, troca obrigatória, validade e bloqueio por tentativas', { timeout: 60_000 }, async t => {
  const fixture = await createTestApi()
  const created = []
  t.after(async () => {
    // Remove a conta criada pelo Controle antes de fechar a conexao com o banco.
    for (const id of created) await fixture.pool.query('DELETE FROM users WHERE id = ?', [id])
    await fixture.close()
  })
  const admin = await fixture.account('admin')
  const adminCookie = (await fixture.login(admin)).cookie

  async function call(method, path, body, cookie = '') {
    const response = await fetch(`${fixture.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const login = (email, password) => call('POST', '/api/auth/login', { email, password })

  const email = `test-${randomUUID()}@example.test`
  const account = await call('POST', '/api/admin/accounts', { name: 'Família Teste', email, status: 'active' }, adminCookie)
  assert.equal(account.status, 201)
  created.push(account.data.id)
  const temporary = account.data.temporaryPassword
  assert.match(temporary, /^[A-HJ-NP-Z2-9]{5}$/)
  const [row] = await fixture.pool.query('SELECT password_hash, must_change_password FROM users WHERE id = ?', [account.data.id])
  assert.equal(Number(row.must_change_password), 1)
  assert.ok(!row.password_hash.includes(temporary))
  const listed = (await call('GET', '/api/admin/accounts', undefined, adminCookie)).data.find(item => item.id === account.data.id)
  assert.equal(listed.mustChangePassword, true)
  assert.equal(listed.temporaryPassword, undefined)

  let familyCookie
  await t.test('com a senha provisória só é possível trocar a senha', async () => {
    const first = await login(email, temporary)
    assert.equal(first.status, 200)
    assert.equal(first.data.user.mustChangePassword, true)
    familyCookie = first.cookie
    const blocked = await call('GET', '/api/profiles', undefined, familyCookie)
    assert.equal(blocked.status, 403)
    assert.equal(blocked.data.code, 'password_change_required')
    assert.equal((await call('GET', '/api/family/overview', undefined, familyCookie)).status, 403)
    assert.equal((await call('GET', '/api/auth/session', undefined, familyCookie)).data.user.mustChangePassword, true)
  })

  await t.test('troca valida a senha atual e o tamanho mínimo, e encerra outras sessões', async () => {
    const other = await login(email, temporary)
    assert.equal((await call('POST', '/api/auth/change-password', { currentPassword: temporary, newPassword: 'curta' }, familyCookie)).status, 400)
    assert.equal((await call('POST', '/api/auth/change-password', { currentPassword: 'ERRAD', newPassword: 'senha-nova-123' }, familyCookie)).status, 401)
    const changed = await call('POST', '/api/auth/change-password', { currentPassword: temporary, newPassword: 'senha-nova-123' }, familyCookie)
    assert.equal(changed.status, 200)
    assert.equal(changed.data.user.mustChangePassword, false)
    assert.equal((await call('GET', '/api/profiles', undefined, familyCookie)).status, 200)
    assert.equal((await call('GET', '/api/auth/session', undefined, other.cookie)).status, 401)
    assert.equal((await login(email, temporary)).status, 401)
    assert.equal((await login(email, 'senha-nova-123')).status, 200)
  })

  await t.test('nova senha provisória no Controle; expirada não entra', async () => {
    const reset = await call('POST', `/api/admin/accounts/${account.data.id}/temporary-password`, {}, adminCookie)
    assert.equal(reset.status, 200)
    assert.match(reset.data.temporaryPassword, /^[A-HJ-NP-Z2-9]{5}$/)
    assert.equal((await call('GET', '/api/auth/session', undefined, familyCookie)).status, 401)
    assert.equal((await login(email, 'senha-nova-123')).status, 401)
    await fixture.pool.query('UPDATE users SET temp_password_expires_at = CURRENT_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?', [account.data.id])
    const expired = await login(email, reset.data.temporaryPassword)
    assert.equal(expired.status, 401)
    assert.equal(expired.data.code, 'temporary_password_expired')
    assert.equal((await call('POST', `/api/admin/accounts/${admin.id}/temporary-password`, {}, adminCookie)).status, 400)
  })

  await t.test('10 senhas erradas bloqueiam o login por 15 minutos', async () => {
    const reset = await call('POST', `/api/admin/accounts/${account.data.id}/temporary-password`, {}, adminCookie)
    for (let attempt = 0; attempt < 10; attempt++) assert.equal((await login(email, 'ERRAD')).status, 401)
    const locked = await login(email, reset.data.temporaryPassword)
    assert.equal(locked.status, 429)
    const unlocked = await call('POST', `/api/admin/accounts/${account.data.id}/temporary-password`, {}, adminCookie)
    assert.equal((await login(email, unlocked.data.temporaryPassword)).status, 200)
  })
})
