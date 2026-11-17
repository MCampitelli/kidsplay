import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { loadPublicTitleTags } from './catalogTags.mjs'
import { createTestApi } from './testSupport.mjs'

test('tags: persistência real no MariaDB e catálogo HTTP, sem alterar registros existentes', { timeout: 60_000 }, async (t) => {
  const fixture = await createTestApi()
  const { pool, base: streaming } = fixture
  const admin = `${streaming}/api/admin`
  const tagIds = []
  const titleIds = []
  const prefix = `Teste ${randomUUID().slice(0, 8)}`
  t.after(async () => {
    try {
      if (titleIds.length) await pool.query(`DELETE FROM titles WHERE id IN (${titleIds.map(() => '?').join(',')})`, titleIds)
      if (tagIds.length) await pool.query(`DELETE FROM title_tags WHERE id IN (${tagIds.map(() => '?').join(',')})`, tagIds)
    } finally {
      await fixture.close()
    }
  })
  const { cookie } = await fixture.login(await fixture.account('admin'))
  async function request(route, { method = 'GET', body, status = 200, base = admin } = {}) {
    const routePath = base === admin ? route.slice('/api'.length) : route
    const response = await fetch(`${base}${routePath}`, {
      method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const result = await response.json()
    assert.equal(response.status, status, JSON.stringify(result))
    return result
  }
  async function tag(name, order = 0, isActive = true) {
    const body = { name: `${prefix} ${name}`, description: 'Fixture de teste', displayOrder: order, isActive }
    const saved = await request('/api/catalog/tags', { method: 'POST', body, status: 201 })
    tagIds.push(saved.id)
    return { ...body, id: saved.id }
  }
  async function title(name, tags = [], status = 'published', displayOrder = 0) {
    const body = { name: `${prefix} ${name}`, tagIds: tags, status, displayOrder, coverPath: '/files/capa-teste.jpg' }
    const saved = await request('/api/catalog/titles', { method: 'POST', body, status: 201 })
    titleIds.push(saved.id)
    return { ...body, id: saved.id, slug: saved.slug }
  }
  const adventure = await tag('Aventura', 30)
  const comedy = await tag('Comédia', 10)
  const inactive = await tag('Inativa', 0, false)
  const empty = await tag('Vazia', 0)
  const draftOnly = await tag('Rascunhos', 0)
  const first = await title('Primeiro', [adventure.id, comedy.id], 'published', -20)
  const second = await title('Segundo', [adventure.id], 'published', 20)
  const tied = await title('Alpha empate', [adventure.id], 'published', 20)
  const draft = await title('Rascunho', [draftOnly.id, adventure.id], 'draft')
  const untagged = await title('Sem tags')

  await t.test('CRUD de tags, slug automático, pesquisa disponível e contagem de títulos', async () => {
    const tags = await request('/api/catalog/tags')
    assert.equal(tags.find((item) => item.id === adventure.id).titleCount, 4)
    assert.match(tags.find((item) => item.id === comedy.id).slug, /comedia$/)
    const renamed = { ...comedy, name: `${prefix} Para os Pequenos`, description: 'Editada', displayOrder: -10 }
    await request(`/api/catalog/tags/${comedy.id}`, { method: 'PUT', body: renamed })
    Object.assign(comedy, renamed)
    const rows = await pool.query('SELECT * FROM title_tags WHERE id = ?', [comedy.id])
    assert.match(rows[0].slug, /para-os-pequenos$/)
    assert.equal(rows[0].description, 'Editada')
    assert.equal(rows[0].display_order, -10)
    await request('/api/catalog/tags', { method: 'POST', body: comedy, status: 409 })
    await request(`/api/catalog/tags/${adventure.id}`, { method: 'PUT', body: comedy, status: 409 })
    await request('/api/catalog/tags', { method: 'POST', body: { ...comedy, name: ' ' }, status: 400 })
    await request('/api/catalog/tags', { method: 'POST', body: { ...comedy, displayOrder: 1.5 }, status: 400 })
    await request('/api/catalog/tags', { method: 'POST', body: { ...comedy, description: 'a'.repeat(256) }, status: 400 })
  })

  await t.test('associações múltiplas são persistidas e carregadas na edição', async () => {
    const catalog = await request('/api/catalog')
    assert.deepEqual(catalog.find((item) => item.id === first.id).tagIds.sort((a, b) => a - b), [adventure.id, comedy.id])
    const rows = await pool.query('SELECT tag_id FROM title_tag_relations WHERE title_id = ?', [first.id])
    assert.equal(rows.length, 2)
  })

  await t.test('TV filtra publicação, tags inativas/vazias e ordena categorias/títulos', async () => {
    const catalog = await request('/api/catalog', { base: streaming })
    const shows = catalog.filter((item) => titleIds.includes(item.id))
    assert.deepEqual(shows.map((item) => item.id), [first.id, untagged.id, tied.id, second.id])
    assert.deepEqual(shows.find((item) => item.id === first.id).tags.map((item) => item.id), [comedy.id, adventure.id])
    assert.deepEqual(shows.find((item) => item.id === untagged.id).tags, [])
    assert.deepEqual(shows.find((item) => item.id === first.id).episodes, [])
    assert.equal(shows.find((item) => item.id === first.id).image, '/files/capa-teste.jpg')
    assert.ok(!shows.some((item) => item.id === draft.id))
    assert.ok(!shows.flatMap((item) => item.tags).some((item) => [inactive.id, empty.id, draftOnly.id].includes(item.id)))
    const relations = await loadPublicTitleTags(pool)
    assert.deepEqual(relations.get(first.id).map((item) => item.id), [comedy.id, adventure.id])
  })

  await t.test('alterar outros campos com tagIds omitido preserva todas as tags', async () => {
    const { tagIds: omitted, ...body } = first
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: { ...body, description: 'Alterada' } })
    const catalog = await request('/api/catalog')
    assert.equal(catalog.find((item) => item.id === first.id).tagIds.length, 2)
  })

  await t.test('desativação preserva relações existentes e impede novas associações', async () => {
    await request(`/api/catalog/tags/${comedy.id}`, { method: 'PUT', body: { ...comedy, isActive: false } })
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: first })
    await request(`/api/catalog/titles/${second.id}`, { method: 'PUT', body: { ...second, tagIds: [comedy.id] }, status: 400 })
    const catalog = await request('/api/catalog', { base: streaming })
    assert.deepEqual(catalog.find((item) => item.id === first.id).tags.map((item) => item.id), [adventure.id])
    const saved = await request('/api/catalog')
    assert.ok(saved.find((item) => item.id === first.id).tagIds.includes(comedy.id))
  })

  await t.test('remoção explícita elimina só as associações desmarcadas; lista vazia remove todas', async () => {
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: { ...first, tagIds: [adventure.id] } })
    await request(`/api/catalog/titles/${second.id}`, { method: 'PUT', body: { ...second, tagIds: [] } })
    const catalog = await request('/api/catalog')
    assert.deepEqual(catalog.find((item) => item.id === first.id).tagIds, [adventure.id])
    assert.deepEqual(catalog.find((item) => item.id === second.id).tagIds, [])
  })

  await t.test('erros de validação e unicidade não deixam alterações parciais', async () => {
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: { ...first, name: 'Não salvar', tagIds: [adventure.id, adventure.id] }, status: 400 })
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: { ...first, name: 'Não salvar', tagIds: [Number.MAX_SAFE_INTEGER] }, status: 400 })
    await request(`/api/catalog/titles/${first.id}`, { method: 'PUT', body: { ...first, slug: second.slug, tagIds: [] }, status: 409 })
    await request('/api/catalog/titles', { method: 'POST', body: { ...first, slug: `${first.slug}-invalid`, tagIds: [inactive.id] }, status: 400 })
    const rows = await pool.query('SELECT name FROM titles WHERE id = ?', [first.id])
    assert.equal(rows[0].name, first.name)
    const relations = await pool.query('SELECT tag_id FROM title_tag_relations WHERE title_id = ?', [first.id])
    assert.deepEqual(relations.map((item) => Number(item.tag_id)), [adventure.id])
    const counts = await pool.query('SELECT COUNT(*) AS count FROM titles WHERE slug = ?', [`${first.slug}-invalid`])
    assert.equal(Number(counts[0].count), 0)
  })

  await t.test('PK composta e chaves estrangeiras existentes permanecem intactas', async () => {
    await assert.rejects(pool.query('INSERT INTO title_tag_relations (title_id, tag_id) VALUES (?, ?)', [first.id, adventure.id]), { code: 'ER_DUP_ENTRY' })
    await assert.rejects(pool.query('INSERT INTO title_tag_relations (title_id, tag_id) VALUES (?, ?)', [first.id, Number.MAX_SAFE_INTEGER]), { code: 'ER_NO_REFERENCED_ROW_2' })
    await assert.rejects(pool.query('INSERT INTO title_tag_relations (title_id, tag_id) VALUES (?, ?)', [Number.MAX_SAFE_INTEGER, adventure.id]), { code: 'ER_NO_REFERENCED_ROW_2' })
  })
})
