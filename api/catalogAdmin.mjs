import fs from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { hashPassword } from './passwords.mjs'
import { slugFromName, listTags, saveTag, loadTitleTagRelations, withTitleTags } from './catalogTags.mjs'
import { MediaProcessingQueue, normalizeMp4Path } from '../video-processing/scripts/media-processing.mjs'

/**
 * @param {{pool: import('mariadb').Pool, authenticatedUser: ReturnType<import('./localApi.js').createApi>['authenticatedUser'], projectRoot?: string}} options
 */
export function createCatalogAdmin({ pool, authenticatedUser, projectRoot = process.cwd() }) {
const pagePath = path.join(projectRoot, 'catalog-admin', 'index.html')
const statuses = new Set(['draft', 'published', 'archived'])
const accountStatuses = new Set(['pending', 'active', 'suspended'])


function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(payload))
}

function fail(statusCode, message) {
  return Object.assign(new Error(message), { statusCode })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 64_000) throw fail(413, 'O formulário excedeu o limite permitido.')
    chunks.push(buffer)
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid object')
    return data
  } catch {
    throw fail(400, 'Dados do formulário inválidos.')
  }
}

function text(value, label, maxLength, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) return null
  if (typeof value !== 'string') throw fail(400, `${label} é obrigatório.`)
  const result = value.trim()
  if (!result && optional) return null
  if (!result || result.length > maxLength) throw fail(400, `${label} deve ter entre 1 e ${maxLength} caracteres.`)
  return result
}

function positiveInteger(value, label, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) return null
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 1) throw fail(400, `${label} deve ser um inteiro positivo.`)
  return result
}

function statusValue(value) {
  const result = value || 'draft'
  if (!statuses.has(result)) throw fail(400, 'Status de publicação inválido.')
  return result
}

function idFromPath(pathname, pattern) {
  const match = pathname.match(pattern)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function loadCatalog() {
  const rows = await pool.query(
    `SELECT
       t.id AS title_id, t.name AS title_name, t.slug, t.description AS title_description,
       t.cover_path, t.poster_path, t.banner_path, t.release_year, t.content_rating,
       t.publication_status AS title_status, t.display_order,
       s.id AS season_id, s.season_number, s.name AS season_name,
       s.description AS season_description, s.publication_status AS season_status,
       e.id AS episode_id, e.episode_number, e.name AS episode_name,
       e.description AS episode_description, e.duration_seconds, e.thumbnail_path,
       e.publication_status AS episode_status,
       m.id AS asset_id, m.asset_format, m.quality, m.asset_path, m.size_bytes, m.is_available
     FROM titles t
     LEFT JOIN seasons s ON s.title_id = t.id
     LEFT JOIN episodes e ON e.season_id = s.id
     LEFT JOIN media_assets m ON m.episode_id = e.id
     ORDER BY t.display_order, t.name, s.season_number, e.episode_number, m.asset_format, m.quality`,
  )

  const titles = new Map()
  const seasons = new Map()
  const episodes = new Map()
  for (const row of rows) {
    let title = titles.get(String(row.title_id))
    if (!title) {
      title = {
        id: Number(row.title_id),
        name: row.title_name,
        slug: row.slug,
        description: row.title_description,
        coverPath: row.cover_path,
        posterPath: row.poster_path,
        bannerPath: row.banner_path,
        releaseYear: row.release_year === null ? null : Number(row.release_year),
        contentRating: row.content_rating,
        status: row.title_status,
        displayOrder: row.display_order,
        seasons: [],
      }
      titles.set(String(row.title_id), title)
    }

    if (row.season_id === null) continue
    const seasonKey = String(row.season_id)
    let season = seasons.get(seasonKey)
    if (!season) {
      season = {
        id: Number(row.season_id),
        titleId: title.id,
        number: Number(row.season_number),
        name: row.season_name,
        description: row.season_description,
        status: row.season_status,
        episodes: [],
      }
      seasons.set(seasonKey, season)
      title.seasons.push(season)
    }

    if (row.episode_id === null) continue
    const episodeKey = String(row.episode_id)
    let episode = episodes.get(episodeKey)
    if (!episode) {
      episode = {
        id: Number(row.episode_id),
        seasonId: season.id,
        number: Number(row.episode_number),
        name: row.episode_name,
        description: row.episode_description,
        durationSeconds: Number(row.duration_seconds),
        thumbnailPath: row.thumbnail_path,
        status: row.episode_status,
        assets: [],
      }
      episodes.set(episodeKey, episode)
      season.episodes.push(episode)
    }

    if (row.asset_id !== null) {
      episode.assets.push({
        id: Number(row.asset_id),
        episodeId: episode.id,
        format: row.asset_format,
        quality: row.quality,
        path: row.asset_path,
        sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
        available: Boolean(row.is_available),
      })
    }
  }
  const relations = await loadTitleTagRelations(pool)
  return [...titles.values()].map((title) => ({ ...title, tagIds: relations.get(title.id) || [] }))
}

async function createTitle(body) {
  return withTitleTags(pool, null, body.tagIds, (connection) => saveTitle(connection, null, body))
}

async function updateTitle(id, body) {
  return withTitleTags(pool, id, body.tagIds, (connection) => saveTitle(connection, id, body))
}

async function saveTitle(connection, id, body) {
  const name = text(body.name, 'Nome do título', 255)
  const slug = text(body.slug || slugFromName(name), 'Slug', 180)
  const releaseYear = positiveInteger(body.releaseYear, 'Ano de lançamento', true)
  if (releaseYear !== null && releaseYear > 65_535) throw fail(400, 'Ano fora do intervalo permitido.')
  const displayOrder = body.displayOrder === '' || body.displayOrder === undefined ? 0 : Number(body.displayOrder)
  if (!Number.isSafeInteger(displayOrder) || displayOrder < -2_147_483_648 || displayOrder > 2_147_483_647) {
    throw fail(400, 'Ordem de exibição inválida.')
  }
  const values = [
    name, slug,
    text(body.description, 'Descrição', 65_535, true),
    text(body.coverPath, 'Caminho da capa', 1024, true),
    text(body.posterPath, 'Caminho do pôster', 1024, true),
    text(body.bannerPath, 'Caminho do banner', 1024, true),
    releaseYear,
    text(body.contentRating, 'Classificação indicativa', 16, true),
    statusValue(body.status), displayOrder,
  ]
  if (id !== null) {
    await connection.query(
      `UPDATE titles SET name = ?, slug = ?, description = ?, cover_path = ?, poster_path = ?, banner_path = ?,
       release_year = ?, content_rating = ?, publication_status = ?, display_order = ? WHERE id = ?`,
      [...values, id],
    )
    return { id, name, slug }
  }
  const result = await connection.query(
    `INSERT INTO titles
       (name, slug, description, cover_path, poster_path, banner_path, release_year, content_rating, publication_status, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values,
  )
  return { id: Number(result.insertId), name, slug }
}

async function createSeason(body) {
  const titleId = positiveInteger(body.titleId, 'Título')
  const number = positiveInteger(body.number, 'Número da temporada')
  if (number > 65_535) throw fail(400, 'Número da temporada fora do intervalo permitido.')
  const result = await pool.query(
    `INSERT INTO seasons (title_id, season_number, name, description, publication_status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      titleId,
      number,
      text(body.name, 'Nome da temporada', 255, true),
      text(body.description, 'Descrição', 65_535, true),
      statusValue(body.status),
    ],
  )
  return { id: Number(result.insertId), titleId, number }
}

async function updateSeason(id, body) {
  const titleId = positiveInteger(body.titleId, 'Título')
  const number = positiveInteger(body.number, 'Número da temporada')
  if (number > 65_535) throw fail(400, 'Número da temporada fora do intervalo permitido.')
  await pool.query(
    `UPDATE seasons SET title_id = ?, season_number = ?, name = ?, description = ?, publication_status = ? WHERE id = ?`,
    [
      titleId,
      number,
      text(body.name, 'Nome da temporada', 255, true),
      text(body.description, 'Descrição', 65_535, true),
      statusValue(body.status),
      id,
    ],
  )
  const exists = await pool.query('SELECT id FROM seasons WHERE id = ? LIMIT 1', [id])
  if (!exists.length) throw fail(404, 'Temporada não encontrada.')
  return { id, titleId, number }
}

async function createEpisode(body) {
  const seasonId = positiveInteger(body.seasonId, 'Temporada')
  const number = positiveInteger(body.number, 'Número do episódio')
  if (number > 65_535) throw fail(400, 'Número do episódio fora do intervalo permitido.')
  const durationSeconds = positiveInteger(body.durationSeconds, 'Duração')
  const result = await pool.query(
    `INSERT INTO episodes
       (season_id, episode_number, name, description, duration_seconds, thumbnail_path, publication_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      seasonId,
      number,
      text(body.name, 'Nome do episódio', 255),
      text(body.description, 'Descrição', 65_535, true),
      durationSeconds,
      text(body.thumbnailPath, 'Caminho da miniatura', 1024, true),
      statusValue(body.status),
    ],
  )
  return { id: Number(result.insertId), seasonId, number }
}

async function updateEpisode(id, body) {
  const seasonId = positiveInteger(body.seasonId, 'Temporada')
  const number = positiveInteger(body.number, 'Número do episódio')
  if (number > 65_535) throw fail(400, 'Número do episódio fora do intervalo permitido.')
  const durationSeconds = positiveInteger(body.durationSeconds, 'Duração')
  await pool.query(
    `UPDATE episodes SET season_id = ?, episode_number = ?, name = ?, description = ?, duration_seconds = ?,
       thumbnail_path = ?, publication_status = ? WHERE id = ?`,
    [
      seasonId,
      number,
      text(body.name, 'Nome do episódio', 255),
      text(body.description, 'Descrição', 65_535, true),
      durationSeconds,
      text(body.thumbnailPath, 'Caminho da miniatura', 1024, true),
      statusValue(body.status),
      id,
    ],
  )
  const exists = await pool.query('SELECT id FROM episodes WHERE id = ? LIMIT 1', [id])
  if (!exists.length) throw fail(404, 'Episódio não encontrado.')
  return { id, seasonId, number }
}

async function saveMediaAsset(body) {
  const episodeId = positiveInteger(body.episodeId, 'Episódio')
  const format = body.format
  if (!['mp4', 'hls'].includes(format)) throw fail(400, 'Formato de mídia inválido.')
  const quality = text(body.quality || 'source', 'Qualidade', 16)
  const assetPath = text(body.path, 'Caminho do arquivo', 2048)
  const sizeBytes = positiveInteger(body.sizeBytes, 'Tamanho em bytes', true)
  const available = body.available === false ? 0 : 1
  await pool.query(
    `INSERT INTO media_assets (episode_id, asset_format, quality, asset_path, size_bytes, is_available)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE asset_path = VALUES(asset_path), size_bytes = VALUES(size_bytes), is_available = VALUES(is_available)`,
    [episodeId, format, quality, assetPath, sizeBytes, available],
  )
  if (Object.hasOwn(body, 'thumbnailPath')) {
    await pool.query(
      'UPDATE episodes SET thumbnail_path = ? WHERE id = ?',
      [text(body.thumbnailPath, 'Caminho da miniatura', 1024, true), episodeId],
    )
  }
  const rows = await pool.query(
    `SELECT id, episode_id, asset_format, quality, asset_path, size_bytes, is_available
     FROM media_assets WHERE episode_id = ? AND asset_format = ? AND quality = ? LIMIT 1`,
    [episodeId, format, quality],
  )
  const asset = rows[0]
  return {
    id: Number(asset.id),
    episodeId: Number(asset.episode_id),
    format: asset.asset_format,
    quality: asset.quality,
    path: asset.asset_path,
    sizeBytes: asset.size_bytes === null ? null : Number(asset.size_bytes),
    available: Boolean(asset.is_available),
  }
}

const mediaRepository = {
  async getEpisodeMedia(episodeId) {
    const episodes = await pool.query(
      `SELECT e.id,
         (SELECT asset_path FROM media_assets WHERE episode_id = e.id AND asset_format = 'mp4' ORDER BY quality = 'source' DESC, id LIMIT 1) AS mp4_path,
         e.thumbnail_path
       FROM episodes e WHERE e.id = ? LIMIT 1`,
      [episodeId],
    )
    if (!episodes.length) return null
    const hlsRows = await pool.query(
      `SELECT asset_path, quality FROM media_assets WHERE episode_id = ? AND asset_format = 'hls' ORDER BY quality`,
      [episodeId],
    )
    return {
      mp4Path: episodes[0].mp4_path,
      thumbnailPath: episodes[0].thumbnail_path,
      hlsAssets: hlsRows.map((row) => ({ path: row.asset_path, quality: row.quality })),
    }
  },

  async saveMp4Asset(episodeId, assetPath, sizeBytes, available) {
    const existing = await pool.query(
      `SELECT quality FROM media_assets WHERE episode_id = ? AND asset_format = 'mp4' ORDER BY quality = 'source' DESC, id LIMIT 1`,
      [episodeId],
    )
    const quality = existing[0]?.quality || 'source'
    await pool.query(
      `INSERT INTO media_assets (episode_id, asset_format, quality, asset_path, size_bytes, is_available)
       VALUES (?, 'mp4', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE asset_path = VALUES(asset_path), size_bytes = VALUES(size_bytes), is_available = VALUES(is_available)`,
      [episodeId, quality, assetPath, sizeBytes, available ? 1 : 0],
    )
  },

  async setMp4Availability(episodeId, assetPath, available, sizeBytes) {
    await pool.query(
      `UPDATE media_assets SET is_available = ?, size_bytes = ?
       WHERE episode_id = ? AND asset_format = 'mp4' AND asset_path = ?`,
      [available ? 1 : 0, sizeBytes, episodeId, assetPath],
    )
  },

  async setThumbnailPath(episodeId, thumbnailPath) {
    await pool.query('UPDATE episodes SET thumbnail_path = ? WHERE id = ?', [thumbnailPath, episodeId])
  },

  async markHlsUnavailable(episodeId) {
    await pool.query(
      `UPDATE media_assets SET is_available = 0 WHERE episode_id = ? AND asset_format = 'hls'`,
      [episodeId],
    )
  },

  async syncHlsAssets(episodeId, assets) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.query(
        `UPDATE media_assets SET is_available = 0 WHERE episode_id = ? AND asset_format = 'hls'`,
        [episodeId],
      )
      for (const asset of assets) {
        await connection.query(
          `INSERT INTO media_assets (episode_id, asset_format, quality, asset_path, size_bytes, is_available)
           VALUES (?, 'hls', ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE asset_path = VALUES(asset_path), size_bytes = VALUES(size_bytes), is_available = 1`,
          [episodeId, asset.quality, asset.path, asset.sizeBytes],
        )
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  },

  async listMp4Assets() {
    const rows = await pool.query(
      `SELECT episode_id AS episodeId FROM media_assets WHERE asset_format = 'mp4' GROUP BY episode_id ORDER BY episode_id`,
    )
    return rows.map((row) => ({ episodeId: Number(row.episodeId) }))
  },
}

const mediaProcessing = new MediaProcessingQueue({ projectRoot, repository: mediaRepository })

function normalizeEmail(value) {
  const email = text(value, 'E-mail', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Informe um e-mail válido.')
  return email
}

function accountStatus(value) {
  const result = value || 'active'
  if (!accountStatuses.has(result)) throw fail(400, 'Status da conta inválido.')
  return result
}

async function listAccounts() {
  const rows = await pool.query(
    `SELECT id, name, email, status, email_verified_at, created_at
     FROM users WHERE status <> 'deleted' ORDER BY created_at DESC, id DESC`,
  )
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    status: row.status,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
  }))
}

async function createAccount(body) {
  if (Object.hasOwn(body, 'role')) throw fail(400, 'Privilégios são gerenciados somente pelo provisionamento local.')
  const name = text(body.name, 'Nome', 160)
  const email = normalizeEmail(body.email)
  if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 1024) {
    throw fail(400, 'A senha deve ter pelo menos 12 caracteres.')
  }
  const status = accountStatus(body.status)
  const passwordHash = await hashPassword(body.password)
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, status, email_verified_at)
     VALUES (?, ?, ?, ?, CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP(3) ELSE NULL END)`,
    [name, email, passwordHash, status, status],
  )
  return { id: Number(result.insertId), name, email, status, emailVerified: status === 'active' }
}

async function updateAccount(id, body) {
  if (Object.hasOwn(body, 'role')) throw fail(400, 'Privilégios são gerenciados somente pelo provisionamento local.')
  const name = text(body.name, 'Nome', 160)
  const email = normalizeEmail(body.email)
  const status = accountStatus(body.status)
  await pool.query(
    `UPDATE users SET name = ?, email = ?, status = ?,
       email_verified_at = CASE WHEN ? = 'active' THEN COALESCE(email_verified_at, CURRENT_TIMESTAMP(3)) ELSE email_verified_at END
     WHERE id = ? AND status <> 'deleted'`,
    [name, email, status, status, id],
  )
  const rows = await pool.query(
    `SELECT id, name, email, status, email_verified_at FROM users WHERE id = ? AND status <> 'deleted' LIMIT 1`,
    [id],
  )
  if (!rows.length) throw fail(404, 'Conta não encontrada.')
  const account = rows[0]
  return {
    id: Number(account.id),
    name: account.name,
    email: account.email,
    status: account.status,
    emailVerified: account.email_verified_at !== null,
  }
}

const suggestionStatuses = new Set(['pending', 'added', 'declined'])

// Sugestoes de desenhos enviadas pela Area dos Pais.
async function listSuggestions() {
  const rows = await pool.query(
    `SELECT s.id, s.title_name, s.note, s.status, s.admin_note, s.created_at, s.updated_at,
       u.name AS account_name, u.email AS account_email, p.name AS profile_name
     FROM title_suggestions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN profiles p ON p.id = s.profile_id
     ORDER BY s.status = 'pending' DESC, s.created_at DESC
     LIMIT 300`,
  )
  return rows.map((row) => ({
    id: Number(row.id),
    titleName: row.title_name,
    note: row.note,
    status: row.status,
    adminNote: row.admin_note,
    accountName: row.account_name,
    accountEmail: row.account_email,
    profileName: row.profile_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function updateSuggestion(id, body) {
  if (!suggestionStatuses.has(body.status)) throw fail(400, 'Status da sugestão inválido.')
  const adminNote = text(body.adminNote, 'Resposta', 500, true)
  const result = await pool.query('UPDATE title_suggestions SET status = ?, admin_note = ? WHERE id = ?', [body.status, adminNote || null, id])
  if (!result.affectedRows) throw fail(404, 'Sugestão não encontrada.')
  return (await listSuggestions()).find((suggestion) => suggestion.id === id)
}

async function handle(req, res, pathname = new URL(req.url || '/', 'http://localhost').pathname) {
  try {
    if (pathname.startsWith('/api/')) {
      const user = await authenticatedUser(req)
      if (!user) throw fail(401, 'Entre com uma conta administrativa.')
      if (user.role !== 'admin') throw fail(403, 'Acesso exclusivo de administradores.')
    }
    if (req.method === 'GET' && pathname === '/') {
      const page = await readFile(pagePath)
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:",
        'X-Content-Type-Options': 'nosniff',
      })
      return res.end(page)
    }
    if (req.method === 'GET' && pathname === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await readFile(path.join(path.dirname(pagePath), 'styles.css')))
    }
    if (req.method === 'GET' && pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await readFile(path.join(path.dirname(pagePath), 'app.js')))
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      const rows = await pool.query('SELECT DATABASE() AS database_name, VERSION() AS mariadb_version')
      return sendJson(res, 200, rows[0])
    }
    if (req.method === 'GET' && pathname === '/api/catalog') {
      return sendJson(res, 200, await loadCatalog())
    }
    if (req.method === 'GET' && pathname === '/api/catalog/tags') {
      return sendJson(res, 200, await listTags(pool))
    }
    if (req.method === 'POST' && pathname === '/api/catalog/tags') {
      return sendJson(res, 201, await saveTag(pool, null, await readBody(req)))
    }
    const tagId = idFromPath(pathname, /^\/api\/catalog\/tags\/(\d+)$/)
    if (req.method === 'PUT' && tagId !== null) {
      return sendJson(res, 200, await saveTag(pool, tagId, await readBody(req)))
    }
    if (req.method === 'GET' && pathname === '/api/media-processing/jobs') {
      await mediaProcessing.refreshJournal()
      return sendJson(res, 200, { jobs: mediaProcessing.getJobs(), workerAvailable: mediaProcessing.hasWorkerLock })
    }
    if (req.method === 'POST' && pathname === '/api/media-processing/pending') {
      await readBody(req)
      const result = await mediaProcessing.enqueuePending()
      return sendJson(res, 202, { ...result, jobs: mediaProcessing.getJobs() })
    }
    const mediaEpisodeId = idFromPath(pathname, /^\/api\/media-processing\/episodes\/(\d+)$/)
    if (req.method === 'POST' && mediaEpisodeId !== null) {
      const body = await readBody(req)
      const normalizedPath = normalizeMp4Path(text(body.path, 'Caminho do MP4', 2048), projectRoot)
      let sourceStats = null
      try {
        sourceStats = await fs.stat(normalizedPath.absolutePath)
        if (!sourceStats.isFile()) sourceStats = null
      } catch {
        sourceStats = null
      }
      await mediaRepository.saveMp4Asset(
        mediaEpisodeId,
        normalizedPath.assetPath,
        sourceStats?.size ?? null,
        Boolean(sourceStats && sourceStats.size > 0),
      )
      const job = await mediaProcessing.enqueue(mediaEpisodeId, { force: true })
      return sendJson(res, 202, {
        episodeId: mediaEpisodeId,
        path: normalizedPath.assetPath,
        available: Boolean(sourceStats && sourceStats.size > 0),
        job,
      })
    }
    const retryEpisodeId = idFromPath(pathname, /^\/api\/media-processing\/episodes\/(\d+)\/retry$/)
    if (req.method === 'POST' && retryEpisodeId !== null) {
      await readBody(req)
      const job = await mediaProcessing.enqueue(retryEpisodeId, { force: true })
      return sendJson(res, 202, { job })
    }
    if (req.method === 'GET' && pathname === '/api/suggestions') {
      return sendJson(res, 200, await listSuggestions())
    }
    const suggestionId = idFromPath(pathname, /^\/api\/suggestions\/(\d+)$/)
    if (req.method === 'PUT' && suggestionId !== null) {
      return sendJson(res, 200, await updateSuggestion(suggestionId, await readBody(req)))
    }
    if (req.method === 'GET' && pathname === '/api/accounts') {
      return sendJson(res, 200, await listAccounts())
    }
    if (req.method === 'POST' && pathname === '/api/accounts') {
      return sendJson(res, 201, await createAccount(await readBody(req)))
    }
    const accountId = idFromPath(pathname, /^\/api\/accounts\/(\d+)$/)
    if (req.method === 'PUT' && accountId !== null) {
      return sendJson(res, 200, await updateAccount(accountId, await readBody(req)))
    }

    if (req.method === 'POST' && pathname === '/api/catalog/titles') {
      return sendJson(res, 201, await createTitle(await readBody(req)))
    }
    const titleId = idFromPath(pathname, /^\/api\/catalog\/titles\/(\d+)$/)
    if (req.method === 'PUT' && titleId !== null) {
      return sendJson(res, 200, await updateTitle(titleId, await readBody(req)))
    }

    if (req.method === 'POST' && pathname === '/api/catalog/seasons') {
      return sendJson(res, 201, await createSeason(await readBody(req)))
    }
    const seasonId = idFromPath(pathname, /^\/api\/catalog\/seasons\/(\d+)$/)
    if (req.method === 'PUT' && seasonId !== null) {
      return sendJson(res, 200, await updateSeason(seasonId, await readBody(req)))
    }

    if (req.method === 'POST' && pathname === '/api/catalog/episodes') {
      return sendJson(res, 201, await createEpisode(await readBody(req)))
    }
    const episodeId = idFromPath(pathname, /^\/api\/catalog\/episodes\/(\d+)$/)
    if (req.method === 'PUT' && episodeId !== null) {
      return sendJson(res, 200, await updateEpisode(episodeId, await readBody(req)))
    }

    if (req.method === 'POST' && pathname === '/api/catalog/assets') {
      return sendJson(res, 200, await saveMediaAsset(await readBody(req)))
    }

    return sendJson(res, 404, { error: 'Rota não encontrada.' })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      const message = req.url?.startsWith('/api/accounts')
        ? 'Já existe uma conta com esse e-mail.'
        : 'Esse slug ou número já está cadastrado.'
      return sendJson(res, 409, { error: message })
    }
    const statusCode = Number(error.statusCode) || 500
    if (statusCode === 500) {
      console.error('[catalog-admin] request failed', error.code || error.errno || 'unknown')
      return sendJson(res, 500, { error: 'Não foi possível concluir o cadastro.' })
    }
    return sendJson(res, statusCode, { error: error.message })
  }
}

return {
  handle,
  initialize: () => mediaProcessing.initialize(),
  close: () => mediaProcessing.stop(),
}
}
