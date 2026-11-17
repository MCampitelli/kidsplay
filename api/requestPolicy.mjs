/** @param {ReturnType<import('../config/environment.mjs').readConfig>['api']} config */
export function createRequestPolicy(config) {
  const attempts = new Map()
  /** @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res */
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    const reject = (status, error) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error }))
      return false
    }
    const suppliedOrigin = req.headers.origin
    if (suppliedOrigin) {
      let parsed
      try { parsed = new URL(suppliedOrigin) } catch { return reject(403, 'Origem inválida.') }
      const localOrigin = `http://${req.headers.host}`
      const allowed = parsed.origin === suppliedOrigin && (
        config.allowedOrigins.includes(suppliedOrigin) ||
        (!config.production && suppliedOrigin === localOrigin)
      )
      if (!allowed) return reject(403, 'Origem não permitida.')
      res.setHeader('Access-Control-Allow-Origin', suppliedOrigin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      if (!suppliedOrigin) return reject(403, 'Origem obrigatória.')
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return false
    }
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return reject(415, 'Use Content-Type application/json.')
      }
      if (req.headers['sec-fetch-site'] === 'cross-site' && !suppliedOrigin) {
        return reject(403, 'Origem obrigatória.')
      }
    }
    if (req.method === 'POST' && req.url?.split('?')[0] === '/api/auth/login') {
      const now = Date.now()
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key)
      const key = req.socket.remoteAddress || 'unknown'
      const attempt = attempts.get(key) || { count: 0, until: now + 15 * 60_000 }
      if (attempt.count >= 20 || (!attempts.has(key) && attempts.size >= 10_000)) {
        res.setHeader('Retry-After', '900')
        return reject(429, 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.')
      }
      attempt.count += 1
      attempts.set(key, attempt)
    }
    return true
  }
}
