const routes = [
  [/^\/api\/auth\/login$/, new Set(['POST'])],
  [/^\/api\/auth\/session$/, new Set(['GET'])],
  [/^\/api\/auth\/logout$/, new Set(['POST'])],
  [/^\/api\/health$/, new Set(['GET'])],
  [/^\/api\/status$/, new Set(['GET'])],
  [/^\/api\/catalog$/, new Set(['GET'])],
  [/^\/api\/catalog\/tags$/, new Set(['GET', 'POST'])],
  [/^\/api\/catalog\/tags\/\d+$/, new Set(['PUT'])],
  [/^\/api\/catalog\/titles$/, new Set(['POST'])],
  [/^\/api\/catalog\/titles\/\d+$/, new Set(['PUT'])],
  [/^\/api\/catalog\/seasons$/, new Set(['POST'])],
  [/^\/api\/catalog\/seasons\/\d+$/, new Set(['PUT'])],
  [/^\/api\/catalog\/episodes$/, new Set(['POST'])],
  [/^\/api\/catalog\/episodes\/\d+$/, new Set(['PUT'])],
  [/^\/api\/accounts$/, new Set(['GET', 'POST'])],
  [/^\/api\/accounts\/\d+$/, new Set(['PUT'])],
  [/^\/api\/accounts\/\d+\/temporary-password$/, new Set(['POST'])],
  [/^\/api\/suggestions$/, new Set(['GET'])],
  [/^\/api\/suggestions\/\d+$/, new Set(['PUT'])],
  [/^\/api\/media-processing\/jobs$/, new Set(['GET'])],
  [/^\/api\/media-processing\/pending$/, new Set(['POST'])],
  [/^\/api\/media-processing\/episodes\/\d+(?:\/retry)?$/, new Set(['POST'])],
]

const adminEndpoints = [
  ['/api/status', '/api/admin/status'],
  ['/api/catalog', '/api/admin/catalog'],
  ['/api/catalog/tags', '/api/admin/catalog/tags'],
  ['/api/catalog/titles', '/api/admin/catalog/titles'],
  ['/api/catalog/seasons', '/api/admin/catalog/seasons'],
  ['/api/catalog/episodes', '/api/admin/catalog/episodes'],
  ['/api/accounts', '/api/admin/accounts'],
  ['/api/media-processing/jobs', '/api/admin/media-processing/jobs'],
  ['/api/media-processing/pending', '/api/admin/media-processing/pending'],
  ['/api/media-processing/episodes', '/api/admin/media-processing/episodes'],
]

export function resolveAdminRequest(path, method) {
  if (typeof path !== 'string' || path.length > 512 || !path.startsWith('/api/')) return null
  if (path.includes('\\') || path.includes('//') || path.includes('?') || path.includes('#') || /%2f|%5c|%2e/i.test(path)) return null
  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : ''
  if (!routes.some(([pattern, methods]) => pattern.test(path) && methods.has(normalizedMethod))) return null
  if (/^\/api\/auth\//.test(path) || path === '/api/health') return { path, method: normalizedMethod }
  for (const [source, target] of adminEndpoints) {
    if (path === source) return { path: target, method: normalizedMethod }
    if (path.startsWith(`${source}/`)) return { path: `${target}${path.slice(source.length)}`, method: normalizedMethod }
  }
  return null
}

export function validateAdminApiOrigin(value, { production = true } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Informe a origem da API.')
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('A URL da API não é válida.') }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('A URL da API deve usar HTTP ou HTTPS.')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Informe somente a origem HTTP(S), sem caminho, usuário, senha ou parâmetros.')
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '::1'
  if (url.protocol !== 'https:' && (!isLoopback || production)) {
    throw new Error('Use HTTPS para APIs remotas. HTTP é permitido apenas para desenvolvimento local.')
  }
  return url.origin
}

export function validateAdminRequestPayload({ path, method, body }) {
  const endpoint = resolveAdminRequest(path, method)
  if (!endpoint) throw new Error('Operação não permitida pelo aplicativo.')
  if (endpoint.method === 'GET') {
    if (body !== undefined) throw new Error('Requisições de leitura não aceitam conteúdo.')
    return { ...endpoint }
  }
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 64_000) {
    throw new Error('O conteúdo da solicitação é inválido ou excede o limite.')
  }
  let parsed
  try { parsed = JSON.parse(body) } catch { throw new Error('O conteúdo da solicitação não é JSON válido.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('O conteúdo da solicitação deve ser um objeto JSON.')
  }
  return { ...endpoint, body }
}
