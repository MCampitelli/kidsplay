import {
  createHash,
  randomBytes,
} from 'node:crypto'
import path from 'node:path'
import type { Pool } from 'mariadb'
import { isProfileStickerId, type ProfileStickerId } from '../src/types/profile.js'
import type { Plugin } from 'vite'
import { createDatabasePool } from '../config/database.mjs'
import { readConfig } from '../config/environment.mjs'
import { createRequestPolicy } from './requestPolicy.mjs'
import { verifyPassword } from './passwords.mjs'
import { loadPublicTitleTags, type CatalogTag } from './catalogTags.mjs'
import { createFamilyApi } from './familyApi.js'

const SESSION_COOKIE = 'kidsplay_session'
const SESSION_DAYS = 14

type ApiConfig = ReturnType<typeof readConfig>

type AuthenticatedUser = {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
}

type ProfileRow = {
  id: string | number | bigint
  name: string
  avatar_path: string | null
}

function profileAvatarFromPath(value: string | null): ProfileStickerId | null {
  if (!value) return null
  const stickerId = value.startsWith('sticker:') ? value.slice('sticker:'.length) : value
  return isProfileStickerId(stickerId) ? stickerId : null
}

type CatalogRow = {
  title_id: string | number | bigint
  title_name: string
  title_description: string | null
  cover_path: string | null
  poster_path: string | null
  banner_path: string | null
  season_id: string | number | bigint | null
  season_number: number | null
  episode_id: string | number | bigint | null
  episode_number: number | null
  episode_name: string | null
  thumbnail_path: string | null
  asset_id: string | number | bigint | null
  asset_format: 'mp4' | 'hls' | null
  quality: string | null
  asset_path: string | null
  is_available: number | boolean | null
}

const SHOW_COLORS = ['#FF6B6B', '#FF9F43', '#4ECDC4', '#6BCB77', '#FFD93D', '#C77DFF']

function publicCatalogAsset(value: string | null): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(/\\/g, '/')
  if (/^https?:\/\//i.test(normalized)) return normalized

  const isPublicRoute = /^\/?(?:files|hls|thumbnails)\//i.test(normalized)
  const projectRoot = process.cwd()
  const localRoots = [
    { directory: path.resolve(projectRoot, 'files'), route: 'files' },
    { directory: path.resolve(projectRoot, 'video-processing', 'output'), route: 'hls' },
    { directory: path.resolve(projectRoot, 'video-processing', 'thumbnails'), route: 'thumbnails' },
  ]
  if (!isPublicRoute && (path.isAbsolute(value) || /^[A-Za-z]:\//.test(normalized))) {
    const absolutePath = path.resolve(value)
    for (const localRoot of localRoots) {
      const relativePath = path.relative(localRoot.directory, absolutePath)
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) continue
      return encodeCatalogPath(`/${localRoot.route}/${relativePath.split(path.sep).join('/')}`)
    }
    return undefined
  }

  const relative = normalized.replace(/^\/+/, '')
  const route = relative.startsWith('files/')
    ? 'files'
    : relative.startsWith('hls/')
      ? 'hls'
      : relative.startsWith('thumbnails/')
        ? 'thumbnails'
        : relative.startsWith('video-processing/output/')
          ? 'hls'
          : null
  if (!route) return undefined
  const routePath = relative.startsWith('video-processing/output/')
    ? relative.slice('video-processing/output/'.length)
    : relative.slice(`${route}/`.length)
  return encodeCatalogPath(`/${route}/${routePath}`)
}

function encodeCatalogPath(value: string): string {
  return value.split('/').map((segment, index) => {
    if (index === 0) return ''
    try {
      return encodeURIComponent(decodeURIComponent(segment))
    } catch {
      return encodeURIComponent(segment)
    }
  }).join('/')
}

function json(res: import('node:http').ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw Object.assign(new Error('Corpo muito grande.'), { statusCode: 413 })
    chunks.push(buffer)
  }

  if (size === 0) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Corpo JSON inválido.'), { statusCode: 400 })
  }
  return value as Record<string, unknown>
}

function getCookie(req: import('node:http').IncomingMessage, name: string): string | null {
  const cookieHeader = req.headers.cookie ?? ''
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=')
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue
    const value = entry.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
  }
  return null
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest()
}

function parseProfileId(pathname: string): number | null {
  const match = pathname.match(/^\/api\/profiles\/(\d+)$/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function createApi(config: ApiConfig, pool: Pool) {

  // Com KIDSPLAY_MEDIA_BASE_URL, as rotas locais viram URLs do storage (R2). Os MP4 originais
  // nao sao enviados ao storage, entao deixam de ser oferecidos e o player usa somente HLS.
  function mediaUrl(value: string | null): string | undefined {
    const local = publicCatalogAsset(value)
    if (!local || !config.mediaBaseUrl || /^https?:\/\//i.test(local)) return local
    if (/^\/files\/.*\.mp4$/i.test(local)) return undefined
    return `${config.mediaBaseUrl}${local}`
  }

  async function loadPlaybackCatalog() {
    if (!pool) throw new Error('MariaDB não está configurado.')
    const rows = (await pool.query(
      `SELECT
        t.id AS title_id, t.name AS title_name, t.description AS title_description,
        t.cover_path, t.poster_path, t.banner_path,
         s.id AS season_id, s.season_number,
         e.id AS episode_id, e.episode_number, e.name AS episode_name, e.thumbnail_path,
         m.id AS asset_id, m.asset_format, m.quality, m.asset_path, m.is_available
       FROM titles t
       LEFT JOIN seasons s ON s.title_id = t.id AND s.publication_status = 'published'
       LEFT JOIN episodes e ON e.season_id = s.id AND e.publication_status = 'published'
       LEFT JOIN media_assets m ON m.episode_id = e.id
       WHERE t.publication_status = 'published'
       ORDER BY t.display_order, t.name, t.id, s.season_number, e.episode_number, m.asset_format, m.quality`,
    )) as CatalogRow[]

    const titles = new Map<string, {
      id: number
      title: string
      description: string | null
      color: string
      image?: string
      banner?: string
      tags: CatalogTag[]
      episodes: Array<{ id: number; title: string; file: string; hls?: string; image?: string }>
    }>()
    const seasons = new Set<string>()
    const episodes = new Map<string, { id: number; title: string; file: string; hls?: string; image?: string }>()
    const mp4Ranks = new Map<string, number>()

    for (const row of rows) {
      const titleId = Number(row.title_id)
      const titleKey = String(row.title_id)
      let title = titles.get(titleKey)
      if (!title) {
        title = {
          id: titleId,
          title: row.title_name,
          description: row.title_description,
          color: SHOW_COLORS[(titleId - 1) % SHOW_COLORS.length],
          image: mediaUrl(row.cover_path) || mediaUrl(row.poster_path) || mediaUrl(row.banner_path),
          banner: mediaUrl(row.banner_path),
          tags: [],
          episodes: [],
        }
        titles.set(titleKey, title)
      }

      if (row.season_id === null || row.episode_id === null) continue
      const seasonKey = String(row.season_id)
      const episodeKey = String(row.episode_id)
      if (!seasons.has(seasonKey)) seasons.add(seasonKey)

      let episode = episodes.get(episodeKey)
      if (!episode) {
        episode = {
          id: Number(row.episode_id),
          title: row.episode_name || `Episódio ${row.episode_number}`,
          file: '',
          image: mediaUrl(row.thumbnail_path) || title.image,
        }
        episodes.set(episodeKey, episode)
        title.episodes.push(episode)
      }

      if (row.asset_id === null || !row.asset_path || !row.is_available) continue
      if (row.asset_format === 'mp4') {
        const rank = row.quality === 'source' ? 1 : 0
        if (rank > (mp4Ranks.get(episodeKey) ?? -1)) {
          episode.file = mediaUrl(row.asset_path) || ''
          mp4Ranks.set(episodeKey, rank)
        }
      } else if (row.asset_format === 'hls' && row.quality === 'master') {
        episode.hls = mediaUrl(row.asset_path)
      }
    }

    const tags = await loadPublicTitleTags(pool)
    return [...titles.values()].map((title) => ({ ...title, tags: tags.get(title.id) || [] }))
  }

  function setSessionCookie(res: import('node:http').ServerResponse, token: string) {
    const secure = config.api.secureCookies ? '; Secure' : ''
    const maxAge = SESSION_DAYS * 24 * 60 * 60
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`,
    )
  }

  function clearSessionCookie(res: import('node:http').ServerResponse) {
    const secure = config.api.secureCookies ? '; Secure' : ''
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`)
  }

  async function authenticatedUser(req: import('node:http').IncomingMessage): Promise<AuthenticatedUser | null> {
    if (!pool) return null
    const token = getCookie(req, SESSION_COOKIE)
    if (!token) return null

    const rows = await pool.query(
      `SELECT u.id, u.name, u.email, u.role
       FROM user_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.expires_at > CURRENT_TIMESTAMP(3)
         AND s.revoked_at IS NULL
         AND u.status = 'active'
       LIMIT 1`,
      [hashToken(token)],
    )
    const user = rows[0] as AuthenticatedUser | undefined
    if (!user) return null

    await pool.query('UPDATE user_sessions SET last_used_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?', [
      hashToken(token),
    ])
    return { id: String(user.id), name: user.name, email: user.email, role: user.role }
  }

  const family = createFamilyApi({
    pool,
    json,
    readJsonBody,
    timeZone: config.timeZone,
    loadTitles: async () => (await loadPlaybackCatalog()).map(({ id, title, image }) => ({ id, title, image })),
  })

  async function handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    next: () => void,
  ) {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (!pathname.startsWith('/api/')) return next()
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method ?? '')) {
      res.setHeader('Allow', 'GET, POST, PUT, DELETE')
      return json(res, 405, { error: 'Método não suportado.' })
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      try {
        await pool.query('SELECT 1')
        return json(res, 200, { status: 'ok' })
      } catch {
        console.error('[kidsplay-api] database health check failed')
        return json(res, 503, { error: 'Banco indisponível.' })
      }
    }
    if (pathname === '/api/catalog' && req.method === 'GET') {
      try {
        // O catalogo exige login e, com ?profileId, omite os desenhos bloqueados pelos pais.
        const user = await authenticatedUser(req)
        if (!user) return json(res, 401, { error: 'Sessão não autenticada.' })
        const catalog = await loadPlaybackCatalog()
        const profileId = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('profileId'))
        if (!Number.isSafeInteger(profileId) || profileId <= 0) return json(res, 200, catalog)
        const [owned] = await pool.query(
          "SELECT id FROM profiles WHERE id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1",
          [profileId, user.id],
        )
        if (!owned) return json(res, 404, { error: 'Perfil não encontrado.' })
        const blocked = await family.blockedTitleIds(profileId)
        return json(res, 200, catalog.filter((title) => !blocked.has(title.id)))
      } catch {
        console.error('[kidsplay-api] catalog request failed')
        return json(res, 503, { error: 'Não foi possível carregar o catálogo do banco de dados.' })
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
        const password = typeof body.password === 'string' ? body.password : ''
        if (!email || email.length > 254 || !password || password.length > 1024) return json(res, 400, { error: 'E-mail ou senha inválidos.' })

        const rows = await pool.query(
          `SELECT id, name, email, password_hash, status, role
           FROM users WHERE email = ? LIMIT 1`,
          [email],
        )
        const account = rows[0] as
          | (AuthenticatedUser & { password_hash: string; status: string })
          | undefined
        if (!account || account.status !== 'active' || !(await verifyPassword(password, account.password_hash))) {
          return json(res, 401, { error: 'E-mail ou senha inválidos.' })
        }

        const token = randomBytes(32).toString('base64url')
        const connection = await pool.getConnection()
        try {
          await connection.beginTransaction()
          await connection.query(
            'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
            [account.id, hashToken(token), new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)],
          )
          await connection.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
            account.id,
          ])
          await connection.commit()
        } catch (error) {
          await connection.rollback()
          throw error
        } finally {
          connection.release()
        }

        setSessionCookie(res, token)
        return json(res, 200, {
          user: { id: Number(account.id), name: account.name, email: account.email, role: account.role },
        })
      } catch (error) {
        if (error instanceof SyntaxError) return json(res, 400, { error: 'Corpo JSON inválido.' })
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode) return json(res, statusCode, { error: 'Requisição inválida.' })
        console.error('[kidsplay-api] login request failed')
        return json(res, 503, { error: 'Não foi possível conectar ao MariaDB.' })
      }
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      try {
        if (pool) {
          const token = getCookie(req, SESSION_COOKIE)
          if (token) {
            await pool.query(
              'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ? AND revoked_at IS NULL',
              [hashToken(token)],
            )
          }
        }
      } catch {
        console.error('[kidsplay-api] logout could not revoke session')
        return json(res, 503, { error: 'Não foi possível encerrar a sessão. Tente novamente.' })
      }
      clearSessionCookie(res)
      return json(res, 204)
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      if (!pool) return json(res, 503, { error: 'Configure a conexão MariaDB no .env local.' })
      try {
        const user = await authenticatedUser(req)
        if (!user) return json(res, 401, { error: 'Sessão não autenticada.' })
        return json(res, 200, { user: { id: Number(user.id), name: user.name, email: user.email, role: user.role } })
      } catch {
        console.error('[kidsplay-api] session request failed')
        return json(res, 503, { error: 'Não foi possível conectar ao MariaDB.' })
      }
    }

    if (pathname === '/api/profiles' || /^\/api\/profiles\/\d+$/.test(pathname)) {
      if (!pool) return json(res, 503, { error: 'Configure a conexão MariaDB no .env local.' })
      try {
        const user = await authenticatedUser(req)
        if (!user) return json(res, 401, { error: 'Sessão não autenticada.' })

        if (pathname === '/api/profiles' && req.method === 'GET') {
          const rows = (await pool.query(
            `SELECT id, name, avatar_path FROM profiles
             WHERE owner_user_id = ? AND status = 'active'
             ORDER BY id`,
            [user.id],
          )) as ProfileRow[]
          return json(res, 200, rows.map((profile) => ({
            id: Number(profile.id),
            name: profile.name,
            avatar: profileAvatarFromPath(profile.avatar_path),
          })))
        }

        if (pathname === '/api/profiles' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          if (!name || name.length > 100) return json(res, 400, { error: 'Nome inválido (máximo 100 caracteres).' })
          const avatar = body.avatar === undefined ? 'teddy' : body.avatar
          if (!isProfileStickerId(avatar)) return json(res, 400, { error: 'Selecione uma figurinha válida.' })

          const existing = await pool.query(
            'SELECT id FROM profiles WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) AND status = \'active\' LIMIT 1',
            [user.id, name],
          )
          if (existing.length) return json(res, 409, { error: 'Já existe um perfil com esse nome.' })

          const connection = await pool.getConnection()
          try {
            await connection.beginTransaction()
            const result = await connection.query(
              'INSERT INTO profiles (owner_user_id, name, avatar_path) VALUES (?, ?, ?)',
              [user.id, name, `sticker:${avatar}`],
            )
            const id = Number(result.insertId)
            await connection.query('INSERT INTO profile_preferences (profile_id) VALUES (?)', [id])
            await connection.commit()
            return json(res, 201, { id, name, avatar })
          } catch (error) {
            await connection.rollback()
            throw error
          } finally {
            connection.release()
          }
        }

        const id = parseProfileId(pathname)
        if (id === null) return json(res, 404, { error: 'Rota não encontrada.' })

        if (req.method === 'PUT') {
          const body = await readJsonBody(req)
          const name = typeof body.name === 'string' ? body.name.trim() : ''
          if (!name || name.length > 100) return json(res, 400, { error: 'Nome inválido (máximo 100 caracteres).' })
          const avatar = body.avatar === undefined ? undefined : body.avatar
          if (avatar !== undefined && !isProfileStickerId(avatar)) return json(res, 400, { error: 'Selecione uma figurinha válida.' })

          const existing = await pool.query(
            'SELECT id FROM profiles WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) AND id <> ? AND status = \'active\' LIMIT 1',
            [user.id, name, id],
          )
          if (existing.length) return json(res, 409, { error: 'Já existe um perfil com esse nome.' })

          const result = await pool.query(
            `UPDATE profiles SET name = ?, avatar_path = COALESCE(?, avatar_path)
             WHERE id = ? AND owner_user_id = ? AND status = 'active'`,
            [name, avatar === undefined ? null : `sticker:${avatar}`, id, user.id],
          )
          if (result.affectedRows === 0) return json(res, 404, { error: 'Perfil não encontrado.' })
          return json(res, 200, { id, name, avatar: avatar ?? null })
        }

        if (req.method === 'DELETE') {
          const result = await pool.query(
            `DELETE FROM profiles WHERE id = ? AND owner_user_id = ?`,
            [id, user.id],
          )
          if (result.affectedRows === 0) return json(res, 404, { error: 'Perfil não encontrado.' })
          return json(res, 204)
        }
      } catch (error) {
        if (error instanceof SyntaxError) return json(res, 400, { error: 'Corpo JSON inválido.' })
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode) return json(res, statusCode, { error: 'Requisição inválida.' })
        console.error('[kidsplay-api] profile request failed')
        return json(res, 503, { error: 'Não foi possível processar a requisição no MariaDB.' })
      }
    }

    if (
      pathname === '/api/playback/progress' ||
      pathname.startsWith('/api/family/') ||
      /^\/api\/profiles\/\d+\/screen-time$/.test(pathname)
    ) {
      if (!pool) return json(res, 503, { error: 'Configure a conexão MariaDB no .env local.' })
      try {
        const user = await authenticatedUser(req)
        if (!user) return json(res, 401, { error: 'Sessão não autenticada.' })
        if (await family.handle(pathname, req, res, user.id)) return
      } catch (error) {
        if (error instanceof SyntaxError) return json(res, 400, { error: 'Corpo JSON inválido.' })
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode) return json(res, statusCode, { error: 'Requisição inválida.' })
        console.error('[kidsplay-api] family request failed')
        return json(res, 503, { error: 'Não foi possível processar a requisição no MariaDB.' })
      }
    }

    return json(res, 404, { error: 'Rota não encontrada.' })
  }

  return { handle, authenticatedUser }
}

export function kidsPlayLocalApi(config: ApiConfig): Plugin {
  function install(server: import('vite').ViteDevServer | import('vite').PreviewServer) {
    const pool = createDatabasePool(config)
    const api = createApi(config, pool)
    const policy = createRequestPolicy(config.api)
    server.httpServer?.once('close', () => {
      void pool.end().catch(() => console.error('[kidsplay-api] database shutdown failed'))
    })
    server.middlewares.use((req, res, next) => {
      void (async () => {
        if (!(req.url ?? '').startsWith('/api/')) return next()
        if (!policy(req, res)) return
        await api.handle(req, res, next)
      })().catch(() => {
        console.error('[kidsplay-api] unexpected request failure')
        if (!res.headersSent) json(res, 500, { error: 'Não foi possível processar a requisição.' })
        else res.end()
      })
    })
  }
  return {
    name: 'kidsplay-local-database-api',
    configureServer: install,
    configurePreviewServer: install,
  }
}