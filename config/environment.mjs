import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

export function loadEnvironment(mode = process.env.KIDSPLAY_ENV || process.env.NODE_ENV || 'development', root = process.cwd()) {
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('KIDSPLAY_ENV deve ser development, test ou production.')
  const values = {}
  for (const name of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    try {
      Object.assign(values, parseEnv(readFileSync(path.join(root, name), 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Não foi possível carregar ${name}.`)
    }
  }
  return { ...values, ...process.env, KIDSPLAY_ENV: mode }
}

function port(value, fallback, name) {
  const text = value ?? String(fallback)
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) throw new Error(`${name} deve ser uma porta válida.`)
  return Number(text)
}

function flag(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  if (value !== 'true' && value !== 'false') throw new Error(`${name} deve ser true ou false.`)
  return value === 'true'
}

function origin(value, name) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${name} deve ser uma origem HTTP(S) válida.`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} deve conter somente protocolo, host e porta.`)
  }
  return url.origin
}

export function readApiTarget(env) {
  return env.KIDSPLAY_API_TARGET ? origin(env.KIDSPLAY_API_TARGET, 'KIDSPLAY_API_TARGET') : undefined
}

export function readConfig(env = loadEnvironment()) {
  const production = env.KIDSPLAY_ENV === 'production'
  const user = env.KIDSPLAY_DB_USER?.trim()
  if (!user) throw new Error('Configure KIDSPLAY_DB_USER no ambiente do backend.')
  if (env.KIDSPLAY_DB_PASSWORD === undefined || (production && !env.KIDSPLAY_DB_PASSWORD)) {
    throw new Error('Configure KIDSPLAY_DB_PASSWORD no ambiente do backend.')
  }
  const secureCookies = flag(env.KIDSPLAY_COOKIE_SECURE, production, 'KIDSPLAY_COOKIE_SECURE')
  if (production && !secureCookies) throw new Error('Produção exige KIDSPLAY_COOKIE_SECURE=true e HTTPS.')
  const allowedOrigins = (env.KIDSPLAY_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
    .map(value => origin(value, 'KIDSPLAY_ALLOWED_ORIGINS'))
  if (production && (!allowedOrigins.length || allowedOrigins.some(value => !value.startsWith('https://')))) {
    throw new Error('Produção exige KIDSPLAY_ALLOWED_ORIGINS com origens HTTPS explícitas.')
  }
  const apiTarget = readApiTarget(env)
  const database = env.KIDSPLAY_DB_NAME?.trim() || 'kidsplay_db'
  const host = env.KIDSPLAY_DB_HOST?.trim() || '127.0.0.1'
  const ssl = flag(env.KIDSPLAY_DB_SSL, false, 'KIDSPLAY_DB_SSL')
  if (env.KIDSPLAY_DB_SSL_CA && !ssl) throw new Error('KIDSPLAY_DB_SSL_CA exige KIDSPLAY_DB_SSL=true.')
  return {
    mode: env.KIDSPLAY_ENV || 'development',
    database: {
      host, database, user, password: env.KIDSPLAY_DB_PASSWORD,
      port: port(env.KIDSPLAY_DB_PORT, 3306, 'KIDSPLAY_DB_PORT'),
      ssl: ssl ? { rejectUnauthorized: true, ...(env.KIDSPLAY_DB_SSL_CA ? { ca: readFileSync(path.resolve(env.KIDSPLAY_DB_SSL_CA), 'utf8') } : {}) } : undefined,
    },
    api: {
      host: env.KIDSPLAY_API_HOST?.trim() || '127.0.0.1',
      port: port(env.KIDSPLAY_API_PORT, 8788, 'KIDSPLAY_API_PORT'),
      secureCookies, allowedOrigins, production,
    },
    adminPort: port(env.KIDSPLAY_CATALOG_ADMIN_PORT, 8787, 'KIDSPLAY_CATALOG_ADMIN_PORT'),
    apiTarget,
  }
}
