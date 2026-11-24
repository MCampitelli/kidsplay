import assert from 'node:assert/strict'
import test from 'node:test'
import { createTestApi } from './testSupport.mjs'

// Area dos Pais contra o MariaDB real: contas, perfis e sugestoes temporarios (removidos ao final).
test('Área dos Pais: limite diário, bloqueio, progresso, assistindo agora e sugestões', { timeout: 60_000 }, async t => {
  const fixture = await createTestApi()
  t.after(() => fixture.close())
  const owner = await fixture.account()
  const stranger = await fixture.account()
  const admin = await fixture.account('admin')
  const { cookie } = await fixture.login(owner)
  const strangerCookie = (await fixture.login(stranger)).cookie
  const adminCookie = (await fixture.login(admin)).cookie

  async function call(method, path, body, as = cookie) {
    const response = await fetch(`${fixture.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie: as },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null }
  }

  const created = await call('POST', '/api/profiles', { name: 'Criança Teste', avatar: 'rocket' })
  assert.equal(created.status, 201)
  const profileId = created.data.id
  const [episode] = await fixture.pool.query(
    `SELECT e.id, t.id AS title_id FROM episodes e
     INNER JOIN seasons s ON s.id = e.season_id INNER JOIN titles t ON t.id = s.title_id
     WHERE e.publication_status = 'published' AND s.publication_status = 'published' AND t.publication_status = 'published'
     LIMIT 1`,
  )

  await t.test('catálogo exige login e só aceita perfis da própria conta', async () => {
    assert.equal((await call('GET', '/api/catalog', undefined, '')).status, 401)
    assert.equal((await call('GET', `/api/catalog?profileId=${profileId}`)).status, 200)
    assert.equal((await call('GET', `/api/catalog?profileId=${profileId}`, undefined, strangerCookie)).status, 404)
  })

  await t.test('limite diário: validação, gravação e remoção', async () => {
    assert.equal((await call('PUT', `/api/family/profiles/${profileId}/controls`, { dailyLimitMinutes: 0 })).status, 400)
    assert.equal((await call('PUT', `/api/family/profiles/${profileId}/controls`, { dailyLimitMinutes: 601 })).status, 400)
    const saved = await call('PUT', `/api/family/profiles/${profileId}/controls`, { dailyLimitMinutes: 1 })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.screenTime.limitMinutes, 1)
    assert.equal(saved.data.screenTime.remainingSeconds, 60)
    assert.equal((await call('PUT', `/api/family/profiles/${profileId}/controls`, { dailyLimitMinutes: 1 }, strangerCookie)).status, 404)
  })

  await t.test('progresso grava histórico, conta tempo (máx. 60s por envio) e esgota o limite', { skip: !episode }, async () => {
    const progress = { profileId, episodeId: Number(episode.id), positionSeconds: 30, durationSeconds: 600, watchedSeconds: 45 }
    const first = await call('POST', '/api/playback/progress', progress)
    assert.equal(first.status, 200)
    assert.equal(first.data.watchedSeconds, 45)
    assert.equal(first.data.remainingSeconds, 15)
    assert.equal((await call('POST', '/api/playback/progress', progress, strangerCookie)).status, 404)
    const second = await call('POST', '/api/playback/progress', { ...progress, positionSeconds: 90, watchedSeconds: 999 })
    assert.equal(second.data.watchedSeconds, 105)
    assert.equal(second.data.remainingSeconds, 0)
    const screen = await call('GET', `/api/profiles/${profileId}/screen-time`)
    assert.equal(screen.data.remainingSeconds, 0)

    const overview = await call('GET', '/api/family/overview')
    const summary = overview.data.profiles.find(profile => profile.id === profileId)
    assert.equal(summary.nowWatching.episodeId, Number(episode.id))
    assert.equal(summary.nowWatching.positionSeconds, 90)
    const detail = await call('GET', `/api/family/profiles/${profileId}`)
    assert.equal(detail.data.history[0].episodeId, Number(episode.id))
    assert.equal(detail.data.usage.length, 7)
    assert.equal(detail.data.usage[0].watchedSeconds, 105)
  })

  await t.test('bloqueio some do catálogo do perfil, mas não do catálogo geral', { skip: !episode }, async () => {
    const titleId = Number(episode.title_id)
    assert.equal((await call('PUT', `/api/family/profiles/${profileId}/controls`, { blockedTitleIds: [999999999] })).status, 400)
    const saved = await call('PUT', `/api/family/profiles/${profileId}/controls`, { blockedTitleIds: [titleId] })
    assert.equal(saved.data.titles.find(title => title.id === titleId).blocked, true)
    const filtered = await call('GET', `/api/catalog?profileId=${profileId}`)
    assert.equal(filtered.data.some(title => title.id === titleId), false)
    const general = await call('GET', '/api/catalog')
    assert.equal(general.data.some(title => title.id === titleId), true)
    await call('PUT', `/api/family/profiles/${profileId}/controls`, { blockedTitleIds: [] })
    assert.equal((await call('GET', `/api/catalog?profileId=${profileId}`)).data.some(title => title.id === titleId), true)
  })

  await t.test('sugestões: família envia, admin responde e a família vê a resposta', async () => {
    assert.equal((await call('POST', '/api/family/suggestions', { titleName: ' ' })).status, 400)
    const sent = await call('POST', '/api/family/suggestions', { titleName: 'Desenho Teste', note: 'dublado', profileId })
    assert.equal(sent.status, 200)
    const suggestion = sent.data[0]
    assert.equal(suggestion.status, 'pending')
    assert.equal(suggestion.profileName, 'Criança Teste')
    assert.equal((await call('GET', '/api/family/suggestions', undefined, strangerCookie)).data.length, 0)

    assert.equal((await call('GET', '/api/admin/suggestions')).status, 403)
    const answered = await call('PUT', `/api/admin/suggestions/${suggestion.id}`, { status: 'added', adminNote: 'Já está no app!' }, adminCookie)
    assert.equal(answered.status, 200)
    assert.equal((await call('PUT', `/api/admin/suggestions/${suggestion.id}`, { status: 'nope' }, adminCookie)).status, 400)
    const mine = await call('GET', '/api/family/suggestions')
    assert.equal(mine.data[0].status, 'added')
    assert.equal(mine.data[0].adminNote, 'Já está no app!')
  })
})
