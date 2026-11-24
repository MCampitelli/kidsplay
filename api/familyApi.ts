import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'mariadb'

// Area dos Pais e controles aplicados na TV: limite diario, bloqueio de desenhos,
// progresso/historico, "assistindo agora" e sugestoes de desenhos ao administrador.

/** Sem sinal do player ha mais que isso, o perfil deixa de aparecer como "assistindo agora". */
const NOW_WATCHING_WINDOW_SECONDS = 45
/** Maior intervalo aceito entre dois sinais de progresso (o player envia a cada ~15s). */
const MAX_PROGRESS_DELTA_SECONDS = 60
const HISTORY_LIMIT = 60
const USAGE_DAYS = 7
const MAX_DAILY_LIMIT_MINUTES = 600

type Json = (res: ServerResponse, status: number, body?: unknown) => void
type ReadJsonBody = (req: IncomingMessage) => Promise<Record<string, unknown>>
type CatalogTitle = { id: number; title: string; image?: string }
type Id = string | number | bigint

export type FamilyContext = {
  pool: Pool
  json: Json
  readJsonBody: ReadJsonBody
  timeZone: string
  /** Catalogo publicado (titulos com arte), para a lista de bloqueio. */
  loadTitles: () => Promise<CatalogTitle[]>
}

/** Data local (YYYY-MM-DD) no fuso da familia, para o limite diario virar a meia-noite certa. */
export function localDate(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function lastDays(timeZone: string, days: number) {
  return Array.from({ length: days }, (_, index) => localDate(timeZone, new Date(Date.now() - index * 86_400_000)))
}

function positiveInt(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function nonNegativeInt(value: unknown, max: number) {
  const number = typeof value === 'number' ? Math.floor(value) : Number.NaN
  return Number.isFinite(number) && number >= 0 ? Math.min(number, max) : null
}

export function createFamilyApi(ctx: FamilyContext) {
  const { pool, json, readJsonBody, timeZone } = ctx

  async function ownedProfile(userId: string, profileId: number) {
    const rows = await pool.query(
      `SELECT p.id, p.name, p.avatar_path, pp.daily_limit_minutes
       FROM profiles p LEFT JOIN profile_preferences pp ON pp.profile_id = p.id
       WHERE p.id = ? AND p.owner_user_id = ? AND p.status = 'active' LIMIT 1`,
      [profileId, userId],
    )
    return rows[0] as { id: Id; name: string; avatar_path: string | null; daily_limit_minutes: number | null } | undefined
  }

  async function screenTime(profileId: number, limitMinutes: number | null) {
    const [row] = await pool.query(
      'SELECT watched_seconds FROM profile_daily_usage WHERE profile_id = ? AND usage_date = ?',
      [profileId, localDate(timeZone)],
    )
    const watchedSeconds = Number(row?.watched_seconds ?? 0)
    const limitSeconds = limitMinutes === null || limitMinutes === undefined ? null : Number(limitMinutes) * 60
    return {
      limitMinutes: limitSeconds === null ? null : Number(limitMinutes),
      watchedSeconds,
      remainingSeconds: limitSeconds === null ? null : Math.max(0, limitSeconds - watchedSeconds),
    }
  }

  async function nowWatching(profileIds: number[]) {
    if (!profileIds.length) return new Map<number, unknown>()
    const rows = await pool.query(
      `SELECT wh.profile_id, wh.position_seconds, wh.duration_seconds, wh.last_played_at,
         e.id AS episode_id, e.name AS episode_name, e.episode_number, t.id AS title_id, t.name AS title_name
       FROM watch_history wh
       INNER JOIN episodes e ON e.id = wh.episode_id
       INNER JOIN seasons s ON s.id = e.season_id
       INNER JOIN titles t ON t.id = s.title_id
       WHERE wh.profile_id IN (?) AND wh.last_played_at > CURRENT_TIMESTAMP(3) - INTERVAL ${NOW_WATCHING_WINDOW_SECONDS} SECOND
       ORDER BY wh.last_played_at DESC`,
      [profileIds],
    )
    const result = new Map<number, unknown>()
    for (const row of rows) {
      const profileId = Number(row.profile_id)
      if (result.has(profileId)) continue
      result.set(profileId, {
        episodeId: Number(row.episode_id),
        episodeTitle: row.episode_name || `Episódio ${row.episode_number}`,
        titleId: Number(row.title_id),
        title: row.title_name,
        positionSeconds: Number(row.position_seconds),
        durationSeconds: Number(row.duration_seconds),
      })
    }
    return result
  }

  /** IDs dos desenhos bloqueados para o perfil (o catalogo da TV os omite). */
  async function blockedTitleIds(profileId: number) {
    const rows = await pool.query('SELECT title_id FROM profile_blocked_titles WHERE profile_id = ?', [profileId])
    return new Set<number>(rows.map((row: { title_id: Id }) => Number(row.title_id)))
  }

  // ---------- TV ----------

  async function recordProgress(req: IncomingMessage, res: ServerResponse, userId: string) {
    const body = await readJsonBody(req)
    const profileId = positiveInt(body.profileId)
    const episodeId = positiveInt(body.episodeId)
    const durationSeconds = nonNegativeInt(body.durationSeconds, 24 * 3600)
    if (!profileId || !episodeId || !durationSeconds) return json(res, 400, { error: 'Progresso inválido.' })
    const positionSeconds = nonNegativeInt(body.positionSeconds, durationSeconds) ?? 0
    const delta = nonNegativeInt(body.watchedSeconds, MAX_PROGRESS_DELTA_SECONDS) ?? 0
    const completed = body.completed === true || positionSeconds >= durationSeconds - 30

    const profile = await ownedProfile(userId, profileId)
    if (!profile) return json(res, 404, { error: 'Perfil não encontrado.' })
    const [episode] = await pool.query("SELECT id FROM episodes WHERE id = ? AND publication_status = 'published'", [episodeId])
    if (!episode) return json(res, 404, { error: 'Episódio não encontrado.' })

    await pool.query(
      `INSERT INTO watch_history (profile_id, episode_id, position_seconds, duration_seconds, is_completed, last_played_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE position_seconds = VALUES(position_seconds), duration_seconds = VALUES(duration_seconds),
         is_completed = GREATEST(is_completed, VALUES(is_completed)), last_played_at = CURRENT_TIMESTAMP(3)`,
      [profileId, episodeId, positionSeconds, durationSeconds, completed ? 1 : 0],
    )
    if (delta > 0) {
      await pool.query(
        `INSERT INTO profile_daily_usage (profile_id, usage_date, watched_seconds) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE watched_seconds = watched_seconds + VALUES(watched_seconds)`,
        [profileId, localDate(timeZone), delta],
      )
    }
    return json(res, 200, await screenTime(profileId, profile.daily_limit_minutes))
  }

  // ---------- Area dos Pais ----------

  async function overview(res: ServerResponse, userId: string) {
    const profiles = await pool.query(
      `SELECT p.id, p.name, p.avatar_path, pp.daily_limit_minutes,
         (SELECT COUNT(*) FROM profile_blocked_titles b WHERE b.profile_id = p.id) AS blocked_count
       FROM profiles p LEFT JOIN profile_preferences pp ON pp.profile_id = p.id
       WHERE p.owner_user_id = ? AND p.status = 'active' ORDER BY p.id`,
      [userId],
    )
    const ids = profiles.map((profile: { id: Id }) => Number(profile.id))
    const watching = await nowWatching(ids)
    const result = []
    for (const profile of profiles) {
      const id = Number(profile.id)
      result.push({
        id,
        name: profile.name,
        avatar: typeof profile.avatar_path === 'string' ? profile.avatar_path.replace(/^sticker:/, '') : null,
        blockedCount: Number(profile.blocked_count),
        screenTime: await screenTime(id, profile.daily_limit_minutes),
        nowWatching: watching.get(id) ?? null,
      })
    }
    return json(res, 200, { profiles: result })
  }

  async function profileDetail(res: ServerResponse, userId: string, profileId: number) {
    const profile = await ownedProfile(userId, profileId)
    if (!profile) return json(res, 404, { error: 'Perfil não encontrado.' })
    const [titles, blocked, watching, history, usageRows] = await Promise.all([
      ctx.loadTitles(),
      blockedTitleIds(profileId),
      nowWatching([profileId]),
      pool.query(
        `SELECT wh.episode_id, wh.position_seconds, wh.duration_seconds, wh.is_completed, wh.last_played_at,
           e.name AS episode_name, e.episode_number, t.id AS title_id, t.name AS title_name
         FROM watch_history wh
         INNER JOIN episodes e ON e.id = wh.episode_id
         INNER JOIN seasons s ON s.id = e.season_id
         INNER JOIN titles t ON t.id = s.title_id
         WHERE wh.profile_id = ? ORDER BY wh.last_played_at DESC LIMIT ${HISTORY_LIMIT}`,
        [profileId],
      ),
      pool.query(
        'SELECT DATE_FORMAT(usage_date, \'%Y-%m-%d\') AS day, watched_seconds FROM profile_daily_usage WHERE profile_id = ? AND usage_date >= ?',
        [profileId, lastDays(timeZone, USAGE_DAYS).at(-1)],
      ),
    ])
    const usageByDay = new Map<string, number>(usageRows.map((row: { day: string; watched_seconds: number }) => [row.day, Number(row.watched_seconds)]))
    return json(res, 200, {
      id: profileId,
      name: profile.name,
      avatar: profile.avatar_path?.replace(/^sticker:/, '') ?? null,
      screenTime: await screenTime(profileId, profile.daily_limit_minutes),
      nowWatching: watching.get(profileId) ?? null,
      titles: titles.map((title) => ({ id: title.id, title: title.title, image: title.image ?? null, blocked: blocked.has(title.id) })),
      usage: lastDays(timeZone, USAGE_DAYS).map((day) => ({ day, watchedSeconds: usageByDay.get(day) ?? 0 })),
      history: history.map((row: Record<string, unknown>) => ({
        episodeId: Number(row.episode_id),
        episodeTitle: row.episode_name || `Episódio ${row.episode_number}`,
        titleId: Number(row.title_id),
        title: row.title_name,
        positionSeconds: Number(row.position_seconds),
        durationSeconds: Number(row.duration_seconds),
        completed: Number(row.is_completed) === 1,
        lastPlayedAt: row.last_played_at instanceof Date ? row.last_played_at.toISOString() : row.last_played_at,
      })),
    })
  }

  async function updateControls(req: IncomingMessage, res: ServerResponse, userId: string, profileId: number) {
    const profile = await ownedProfile(userId, profileId)
    if (!profile) return json(res, 404, { error: 'Perfil não encontrado.' })
    const body = await readJsonBody(req)

    let limit: number | null | undefined
    if (body.dailyLimitMinutes === null) limit = null
    else if (body.dailyLimitMinutes !== undefined) {
      limit = positiveInt(body.dailyLimitMinutes)
      if (limit === null || limit > MAX_DAILY_LIMIT_MINUTES) {
        return json(res, 400, { error: `O limite deve ficar entre 1 e ${MAX_DAILY_LIMIT_MINUTES} minutos.` })
      }
    }

    let blocked: number[] | undefined
    if (body.blockedTitleIds !== undefined) {
      if (!Array.isArray(body.blockedTitleIds) || body.blockedTitleIds.length > 500) return json(res, 400, { error: 'Lista de desenhos inválida.' })
      blocked = [...new Set(body.blockedTitleIds.map(positiveInt))].filter((id): id is number => id !== null)
      if (blocked.length) {
        const existing = await pool.query('SELECT id FROM titles WHERE id IN (?)', [blocked])
        if (existing.length !== blocked.length) return json(res, 400, { error: 'Desenho não encontrado.' })
      }
    }

    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      if (limit !== undefined) {
        await connection.query(
          `INSERT INTO profile_preferences (profile_id, daily_limit_minutes) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE daily_limit_minutes = VALUES(daily_limit_minutes)`,
          [profileId, limit],
        )
      }
      if (blocked !== undefined) {
        await connection.query('DELETE FROM profile_blocked_titles WHERE profile_id = ?', [profileId])
        if (blocked.length) {
          await connection.batch('INSERT INTO profile_blocked_titles (profile_id, title_id) VALUES (?, ?)', blocked.map((id) => [profileId, id]))
        }
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
    return profileDetail(res, userId, profileId)
  }

  async function listSuggestions(res: ServerResponse, userId: string) {
    const rows = await pool.query(
      `SELECT s.id, s.title_name, s.note, s.status, s.admin_note, s.created_at, s.updated_at, p.name AS profile_name
       FROM title_suggestions s LEFT JOIN profiles p ON p.id = s.profile_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100`,
      [userId],
    )
    return json(res, 200, rows.map(publicSuggestion))
  }

  async function createSuggestion(req: IncomingMessage, res: ServerResponse, userId: string) {
    const body = await readJsonBody(req)
    const titleName = typeof body.titleName === 'string' ? body.titleName.trim() : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (!titleName || titleName.length > 160) return json(res, 400, { error: 'Informe o nome do desenho (até 160 caracteres).' })
    if (note.length > 500) return json(res, 400, { error: 'O comentário pode ter até 500 caracteres.' })
    let profileId: number | null = null
    if (body.profileId !== undefined && body.profileId !== null) {
      profileId = positiveInt(body.profileId)
      if (!profileId || !(await ownedProfile(userId, profileId))) return json(res, 400, { error: 'Perfil inválido.' })
    }
    const [{ count }] = await pool.query(
      "SELECT COUNT(*) AS count FROM title_suggestions WHERE user_id = ? AND created_at > CURRENT_TIMESTAMP(3) - INTERVAL 1 DAY",
      [userId],
    )
    if (Number(count) >= 20) return json(res, 429, { error: 'Limite de 20 sugestões por dia atingido.' })
    await pool.query(
      'INSERT INTO title_suggestions (user_id, profile_id, title_name, note) VALUES (?, ?, ?, ?)',
      [userId, profileId, titleName, note || null],
    )
    return listSuggestions(res, userId)
  }

  /** Rotas da TV e da Area dos Pais; retorna false quando a rota nao e desta area. */
  async function handle(pathname: string, req: IncomingMessage, res: ServerResponse, userId: string) {
    if (pathname === '/api/playback/progress' && req.method === 'POST') {
      await recordProgress(req, res, userId)
      return true
    }
    const screenTimeMatch = pathname.match(/^\/api\/profiles\/(\d+)\/screen-time$/)
    if (screenTimeMatch && req.method === 'GET') {
      const profile = await ownedProfile(userId, Number(screenTimeMatch[1]))
      if (!profile) json(res, 404, { error: 'Perfil não encontrado.' })
      else json(res, 200, await screenTime(Number(profile.id), profile.daily_limit_minutes))
      return true
    }
    if (pathname === '/api/family/overview' && req.method === 'GET') {
      await overview(res, userId)
      return true
    }
    const profileMatch = pathname.match(/^\/api\/family\/profiles\/(\d+)$/)
    if (profileMatch && req.method === 'GET') {
      await profileDetail(res, userId, Number(profileMatch[1]))
      return true
    }
    const controlsMatch = pathname.match(/^\/api\/family\/profiles\/(\d+)\/controls$/)
    if (controlsMatch && req.method === 'PUT') {
      await updateControls(req, res, userId, Number(controlsMatch[1]))
      return true
    }
    if (pathname === '/api/family/suggestions' && req.method === 'GET') {
      await listSuggestions(res, userId)
      return true
    }
    if (pathname === '/api/family/suggestions' && req.method === 'POST') {
      await createSuggestion(req, res, userId)
      return true
    }
    return false
  }

  return { handle, blockedTitleIds }
}

export function publicSuggestion(row: Record<string, unknown>) {
  const date = (value: unknown) => (value instanceof Date ? value.toISOString() : value)
  return {
    id: Number(row.id),
    titleName: row.title_name,
    note: row.note ?? null,
    status: row.status,
    adminNote: row.admin_note ?? null,
    profileName: row.profile_name ?? null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  }
}
