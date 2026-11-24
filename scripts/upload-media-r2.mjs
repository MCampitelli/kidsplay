import { readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { loadEnvironment } from '../config/environment.mjs'

// Envia HLS, thumbnails e artes dos titulos para o Cloudflare R2.
// As chaves espelham as rotas locais (/hls, /thumbnails, /files), entao o catalogo
// so precisa trocar a origem via KIDSPLAY_MEDIA_BASE_URL. MP4 originais nao sobem.
// Uso: pnpm media:upload [--dry-run]
const root = process.cwd()
const env = loadEnvironment()
const dryRun = process.argv.includes('--dry-run')

for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
  if (!env[name]?.trim()) throw new Error(`Configure ${name} no .env local.`)
}
const bucket = env.R2_BUCKET.trim()
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() },
})

const sources = [
  { directory: path.join(root, 'video-processing', 'output'), prefix: 'hls', include: (file) => /\.(m3u8|ts)$/i.test(file) },
  { directory: path.join(root, 'video-processing', 'thumbnails'), prefix: 'thumbnails', include: (file) => /\.(jpe?g|png|webp)$/i.test(file) },
  { directory: path.join(root, 'files'), prefix: 'files', include: (file) => /\.(jpe?g|png|webp)$/i.test(file) },
]

const contentTypes = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function cacheControl(key) {
  if (key.endsWith('.m3u8')) return 'public, max-age=300'
  if (key.startsWith('thumbnails/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=86400'
}

async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const files = []
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    // Pastas de staging/backup do encoder nunca devem ir para o storage.
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) files.push(...await walk(full))
    } else if (entry.isFile()) files.push(full)
  }
  return files
}

async function listRemote() {
  const remote = new Map()
  let ContinuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken }))
    for (const object of page.Contents || []) remote.set(object.Key, object.Size)
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  return remote
}

const local = []
for (const source of sources) {
  for (const file of await walk(source.directory)) {
    if (!source.include(file)) continue
    const relative = path.relative(source.directory, file).split(path.sep).join('/')
    local.push({ file, key: `${source.prefix}/${relative}`, size: (await stat(file)).size })
  }
}

const remote = await listRemote()
const pending = local.filter((item) => remote.get(item.key) !== item.size)
const totalBytes = pending.reduce((sum, item) => sum + item.size, 0)
const gb = (bytes) => (bytes / 1024 ** 3).toFixed(2)
console.log(`Arquivos locais: ${local.length} | ja no R2: ${local.length - pending.length} | a enviar: ${pending.length} (${gb(totalBytes)} GB)`)
if (dryRun || pending.length === 0) process.exit(0)

let done = 0
let sentBytes = 0
const failures = []
const startedAt = Date.now()
async function upload(item) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: item.key,
        Body: await readFile(item.file),
        ContentType: contentTypes[path.extname(item.key).toLowerCase()] || 'application/octet-stream',
        CacheControl: cacheControl(item.key),
      }))
      return
    } catch (error) {
      if (attempt === 3) failures.push(`${item.key}: ${error.name || error.message}`)
    }
  }
}

let cursor = 0
async function worker() {
  while (cursor < pending.length) {
    const item = pending[cursor++]
    await upload(item)
    done++
    sentBytes += item.size
    if (done % 100 === 0 || done === pending.length) {
      const seconds = (Date.now() - startedAt) / 1000
      const rate = sentBytes / 1024 ** 2 / seconds
      const remaining = rate > 0 ? Math.round((totalBytes - sentBytes) / 1024 ** 2 / rate / 60) : '?'
      console.log(`${done}/${pending.length} arquivos | ${gb(sentBytes)}/${gb(totalBytes)} GB | ${rate.toFixed(1)} MB/s | ~${remaining} min restantes`)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker))

if (failures.length) {
  console.error(`${failures.length} arquivo(s) falharam; rode o comando de novo para reenviar so o que faltou:`)
  for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`)
  process.exitCode = 1
} else {
  console.log('Envio concluido.')
}
