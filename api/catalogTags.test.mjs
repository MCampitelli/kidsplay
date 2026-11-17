import assert from 'node:assert/strict'
import test from 'node:test'
import { listTags, loadPublicTitleTags, saveTag, slugFromName, tagValues, withTitleTags } from './catalogTags.mjs'

test('slugs seguem a convenção existente, com acentos e separadores normalizados', () => {
  assert.equal(slugFromName('Para os Pequenos'), 'para-os-pequenos')
  assert.equal(slugFromName('  Comédia / Super-heróis!  '), 'comedia-super-herois')
})

test('validação de tags rejeita nome, descrição, ordem e disponibilidade inválidos', () => {
  const valid = { name: ' Aventura ', description: ' Descrição ', displayOrder: -2, isActive: true }
  assert.deepEqual(tagValues(valid), {
    name: 'Aventura', slug: 'aventura', description: 'Descrição', displayOrder: -2, isActive: true,
  })
  for (const patch of [
    { name: '' }, { name: '   ' }, { name: '🎵' }, { name: 'a'.repeat(101) },
    { description: 'a'.repeat(256) }, { description: 1 }, { displayOrder: 1.2 },
    { displayOrder: 2_147_483_648 }, { displayOrder: '1' }, { isActive: 'false' },
  ]) assert.throws(() => tagValues({ ...valid, ...patch }), { statusCode: 400 })
})

function transactionPool({ existing = [], tags = [], failInsert = false } = {}) {
  const calls = []
  const connection = {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
    release() { calls.push('release') },
    async query(sql, values) {
      calls.push({ sql, values })
      if (sql.startsWith('SELECT id FROM titles')) return [{ id: 7 }]
      if (sql.startsWith('SELECT tag_id')) return existing.map((id) => ({ tag_id: id }))
      if (sql.startsWith('SELECT id, is_active')) return tags
      if (sql.startsWith('INSERT INTO title_tag_relations') && failInsert) {
        throw Object.assign(new Error('foreign key failure'), { code: 'ER_NO_REFERENCED_ROW_2' })
      }
      return { affectedRows: 1 }
    },
  }
  return { calls, async getConnection() { return connection } }
}

test('tagIds omitido preserva associações e não altera relações', async () => {
  const pool = transactionPool({ existing: [1, 2] })
  await withTitleTags(pool, 7, undefined, async () => ({ id: 7 }))
  assert.ok(pool.calls.includes('commit'))
  assert.equal(pool.calls.filter((call) => call.sql?.match(/^(INSERT|DELETE)/)).length, 0)
})

test('validação rejeita associações duplicadas ou inválidas antes de abrir transação', async () => {
  const pool = transactionPool()
  for (const ids of [[1, 1], ['1'], [0], [-1], [1.5], null, {}]) {
    await assert.rejects(withTitleTags(pool, null, ids, async () => ({ id: 7 })), { statusCode: 400 })
  }
  assert.deepEqual(pool.calls, [])
})

test('tag inativa existente pode ser preservada e outra associação removida', async () => {
  const pool = transactionPool({ existing: [1, 2], tags: [{ id: 1, is_active: 0 }] })
  await withTitleTags(pool, 7, [1], async () => ({ id: 7 }))
  assert.deepEqual(pool.calls.find((call) => call.sql?.startsWith('DELETE')).values, [7, 2])
  assert.ok(pool.calls.includes('commit'))
})

test('tag inativa nova e tag inexistente provocam rollback antes de salvar título', async () => {
  for (const tags of [[], [{ id: 1, is_active: 0 }]]) {
    const pool = transactionPool({ tags })
    let saved = false
    await assert.rejects(withTitleTags(pool, 7, [1], async () => { saved = true; return { id: 7 } }), { statusCode: 400 })
    assert.equal(saved, false)
    assert.ok(pool.calls.includes('rollback'))
    assert.equal(pool.calls.at(-1), 'release')
  }
})

test('erro de banco ao inserir relações reverte título e não informa sucesso', async () => {
  const pool = transactionPool({ tags: [{ id: 1, is_active: 1 }], failInsert: true })
  await assert.rejects(withTitleTags(pool, null, [1], async () => ({ id: 7 })), { code: 'ER_NO_REFERENCED_ROW_2' })
  assert.ok(pool.calls.includes('rollback'))
  assert.ok(!pool.calls.includes('commit'))
  assert.equal(pool.calls.at(-1), 'release')
})

test('falha ao salvar título reverte a transação e libera conexão', async () => {
  const pool = transactionPool({ existing: [1] })
  await assert.rejects(withTitleTags(pool, 7, [], async () => {
    throw Object.assign(new Error('database write failed'), { code: 'ER_LOCK_DEADLOCK' })
  }), { code: 'ER_LOCK_DEADLOCK' })
  assert.ok(pool.calls.includes('rollback'))
  assert.ok(!pool.calls.includes('commit'))
  assert.equal(pool.calls.at(-1), 'release')
})

test('erros de conexão e consulta são propagados sem catálogo vazio ou sucesso falso', async () => {
  const brokenDatabase = {
    async query() { throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' }) },
    async getConnection() { throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' }) },
  }
  await assert.rejects(listTags(brokenDatabase), { code: 'ECONNREFUSED' })
  await assert.rejects(loadPublicTitleTags(brokenDatabase), { code: 'ECONNREFUSED' })
  await assert.rejects(saveTag(brokenDatabase, null, { name: 'Aventura', isActive: true }), { code: 'ECONNREFUSED' })
  await assert.rejects(withTitleTags(brokenDatabase, null, [], async () => ({ id: 7 })), { code: 'ECONNREFUSED' })
})

test('categorias usam uma consulta em lote, com joins, filtros e ordenação', async () => {
  let queries = 0
  const relations = await loadPublicTitleTags({
    async query(sql) {
      queries += 1
      assert.match(sql, /r.tag_id = g.id/)
      assert.match(sql, /t.id = r.title_id/)
      assert.match(sql, /g.is_active = 1 AND t.publication_status = 'published'/)
      assert.match(sql, /ORDER BY g.display_order, g.name, g.id, t.display_order, t.name, t.id/)
      return [
        { title_id: 7n, id: 1n, name: 'Aventura', slug: 'aventura', display_order: 0 },
        { title_id: 7n, id: 2n, name: 'Comédia', slug: 'comedia', display_order: 1 },
      ]
    },
  })
  assert.equal(queries, 1)
  assert.deepEqual(relations.get(7).map((tag) => tag.id), [1, 2])
})
