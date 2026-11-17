function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

export function slugFromName(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function tagValues(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) {
    throw invalid('Nome da tag deve ter entre 1 e 100 caracteres.')
  }
  const name = body.name.trim()
  const slug = slugFromName(name)
  if (!slug || slug.length > 120) throw invalid('O nome deve gerar um slug válido de até 120 caracteres.')
  const description = body.description == null ? '' : body.description
  if (typeof description !== 'string' || description.trim().length > 255) {
    throw invalid('Descrição da tag deve ter até 255 caracteres.')
  }
  const displayOrder = body.displayOrder === undefined || body.displayOrder === '' ? 0 : body.displayOrder
  if (!Number.isSafeInteger(displayOrder) || displayOrder < -2_147_483_648 || displayOrder > 2_147_483_647) {
    throw invalid('Ordem de exibição inválida.')
  }
  if (typeof body.isActive !== 'boolean') throw invalid('Informe se a tag está ativa.')
  return { name, slug, description: description.trim() || null, displayOrder, isActive: body.isActive }
}

export async function listTags(database) {
  const rows = await database.query(
    `SELECT g.id, g.name, g.slug, g.description, g.display_order, g.is_active,
       COUNT(r.title_id) AS title_count
     FROM title_tags g LEFT JOIN title_tag_relations r ON r.tag_id = g.id
     GROUP BY g.id, g.name, g.slug, g.description, g.display_order, g.is_active
     ORDER BY g.display_order, g.name, g.id`,
  )
  return rows.map((row) => ({
    id: Number(row.id), name: row.name, slug: row.slug, description: row.description,
    displayOrder: Number(row.display_order), isActive: Boolean(row.is_active),
    titleCount: Number(row.title_count),
  }))
}

export async function saveTag(database, id, body) {
  const tag = tagValues(body)
  try {
    if (id === null) {
      const result = await database.query(
        'INSERT INTO title_tags (name, slug, description, display_order, is_active) VALUES (?, ?, ?, ?, ?)',
        [tag.name, tag.slug, tag.description, tag.displayOrder, tag.isActive],
      )
      return { id: Number(result.insertId), ...tag }
    }
    const result = await database.query(
      'UPDATE title_tags SET name = ?, slug = ?, description = ?, display_order = ?, is_active = ? WHERE id = ?',
      [tag.name, tag.slug, tag.description, tag.displayOrder, tag.isActive, id],
    )
    if (!result.affectedRows) {
      const rows = await database.query('SELECT id FROM title_tags WHERE id = ?', [id])
      if (!rows.length) throw invalid('Tag não encontrada.', 404)
    }
    return { id, ...tag }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      throw invalid('Já existe uma tag com o slug gerado desse nome.', 409)
    }
    throw error
  }
}

export async function loadTitleTagRelations(database) {
  const rows = await database.query('SELECT title_id, tag_id FROM title_tag_relations ORDER BY title_id, tag_id')
  const relations = new Map()
  for (const row of rows) {
    const titleId = Number(row.title_id)
    if (!relations.has(titleId)) relations.set(titleId, [])
    relations.get(titleId).push(Number(row.tag_id))
  }
  return relations
}

export async function loadPublicTitleTags(database) {
  const rows = await database.query(
    `SELECT r.title_id, g.id, g.name, g.slug, g.display_order
     FROM title_tags g
     INNER JOIN title_tag_relations r ON r.tag_id = g.id
     INNER JOIN titles t ON t.id = r.title_id
     WHERE g.is_active = 1 AND t.publication_status = 'published'
     ORDER BY g.display_order, g.name, g.id, t.display_order, t.name, t.id`,
  )
  const relations = new Map()
  for (const row of rows) {
    const titleId = Number(row.title_id)
    if (!relations.has(titleId)) relations.set(titleId, [])
    relations.get(titleId).push({
      id: Number(row.id), name: row.name, slug: row.slug, displayOrder: Number(row.display_order),
    })
  }
  return relations
}

export async function withTitleTags(pool, id, tagIds, saveTitle) {
  if (tagIds !== undefined && (
    !Array.isArray(tagIds) || tagIds.some((tagId) => !Number.isSafeInteger(tagId) || tagId < 1) ||
    new Set(tagIds).size !== tagIds.length
  )) throw invalid('Selecione tags válidas, sem duplicatas.')

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (id !== null) {
      const titles = await connection.query('SELECT id FROM titles WHERE id = ? FOR UPDATE', [id])
      if (!titles.length) throw invalid('Título não encontrado.', 404)
    }
    const existing = id === null ? [] : await connection.query(
      'SELECT tag_id FROM title_tag_relations WHERE title_id = ? FOR UPDATE', [id],
    )
    const previous = new Set(existing.map((row) => Number(row.tag_id)))
    if (tagIds?.length) {
      const tags = await connection.query(
        `SELECT id, is_active FROM title_tags WHERE id IN (${tagIds.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`,
        tagIds,
      )
      if (tags.length !== tagIds.length) throw invalid('Uma das tags selecionadas não existe.')
      if (tags.some((tag) => !tag.is_active && !previous.has(Number(tag.id)))) {
        throw invalid('Tags desativadas não podem receber novas associações.')
      }
    }
    const saved = await saveTitle(connection)
    const titleId = saved.id
    // Omitted tagIds preserves relations for existing API clients.
    if (tagIds !== undefined) {
      const removed = [...previous].filter((tagId) => !tagIds.includes(tagId))
      if (removed.length) {
        await connection.query(
          `DELETE FROM title_tag_relations WHERE title_id = ? AND tag_id IN (${removed.map(() => '?').join(',')})`,
          [titleId, ...removed],
        )
      }
      const added = tagIds.filter((tagId) => !previous.has(tagId))
      if (added.length) {
        await connection.query(
          `INSERT INTO title_tag_relations (title_id, tag_id) VALUES ${added.map(() => '(?, ?)').join(',')}`,
          added.flatMap((tagId) => [titleId, tagId]),
        )
      }
    }
    await connection.commit()
    return saved
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
