import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

function isInside(root, filePath) {
  return filePath === root || filePath.startsWith(`${root}${path.sep}`)
}

function resolveReference(uri, manifestPath, outputRoot) {
  const value = uri.split(/[?#]/, 1)[0]
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.includes('\\')) {
    throw new Error(`Referência HLS inválida: ${uri}`)
  }

  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error(`Referência HLS com codificação inválida: ${uri}`)
  }

  const resolved = path.resolve(path.dirname(manifestPath), ...decoded.split('/'))
  if (!isInside(outputRoot, resolved)) throw new Error(`Referência HLS fora da saída: ${uri}`)
  return resolved
}

async function assertNonEmptyFile(filePath) {
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size === 0) throw new Error(`Arquivo HLS ausente ou vazio: ${filePath}`)
  if (path.extname(filePath).toLowerCase() === '.ts') {
    const handle = await fs.open(filePath, 'r')
    try {
      const firstByte = Buffer.alloc(1)
      await handle.read(firstByte, 0, 1, 0)
      if (firstByte[0] !== 0x47) throw new Error(`Segmento MPEG-TS inválido: ${filePath}`)
    } finally {
      await handle.close()
    }
  }
  return stats.size
}

export async function validateHls(masterPath, { outputRoot = path.dirname(masterPath) } = {}) {
  const root = path.resolve(outputRoot)
  const master = path.resolve(masterPath)
  if (!isInside(root, master)) throw new Error('A playlist principal está fora da pasta de saída HLS.')

  const visited = new Set()
  const visiting = new Set()
  const playlists = []
  const segments = []
  const resources = []

  async function visitPlaylist(filePath, isRoot = false) {
    if (visiting.has(filePath)) throw new Error(`Referência circular de playlist: ${filePath}`)
    if (visited.has(filePath)) return
    if (visited.size >= 256) throw new Error('A saída HLS referencia playlists demais.')
    visiting.add(filePath)

    const sizeBytes = await assertNonEmptyFile(filePath)
    const content = await fs.readFile(filePath, 'utf8')
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines[0] !== '#EXTM3U') throw new Error(`Manifesto inválido: ${filePath}`)

    let streamInfoPending = false
    let segmentInfoPending = false
    let streamCount = 0
    let segmentCount = 0
    const childPlaylists = []
    const mediaSegments = []
    const auxiliaryResources = []

    for (const line of lines.slice(1)) {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        if (streamInfoPending) throw new Error(`Variante sem URI em ${filePath}`)
        streamInfoPending = true
        streamCount += 1
        continue
      }
      if (line.startsWith('#EXTINF:')) {
        const duration = Number.parseFloat(line.slice('#EXTINF:'.length).split(',', 1)[0])
        if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Duração de segmento inválida em ${filePath}`)
        segmentInfoPending = true
        continue
      }
      if (line.startsWith('#')) {
        for (const match of line.matchAll(/URI="([^"]+)"/g)) {
          auxiliaryResources.push(match[1])
        }
        continue
      }

      const referencedPath = resolveReference(line, filePath, root)
      if (path.extname(referencedPath).toLowerCase() === '.m3u8') {
        if (streamInfoPending) streamInfoPending = false
        else if (isRoot && streamCount > 0) throw new Error(`Playlist de variante sem EXT-X-STREAM-INF em ${filePath}`)
        childPlaylists.push(referencedPath)
      } else {
        if (streamInfoPending) throw new Error(`Variante sem playlist em ${filePath}`)
        if (!segmentInfoPending) throw new Error(`Segmento sem EXTINF em ${filePath}`)
        segmentInfoPending = false
        segmentCount += 1
        mediaSegments.push(referencedPath)
      }
    }

    if (streamInfoPending || segmentInfoPending) throw new Error(`Manifesto HLS incompleto: ${filePath}`)
    if (streamCount > 0 && childPlaylists.length !== streamCount) {
      throw new Error(`Número de playlists não corresponde às variantes em ${filePath}`)
    }
    if (streamCount === 0 && (segmentCount === 0 || !lines.includes('#EXT-X-ENDLIST'))) {
      throw new Error(`Playlist VOD sem segmentos ou EXT-X-ENDLIST: ${filePath}`)
    }
    if (isRoot && streamCount === 0) throw new Error('A playlist principal não contém variantes HLS.')

    for (const referencedPath of childPlaylists) await visitPlaylist(referencedPath)
    for (const referencedPath of [...mediaSegments, ...auxiliaryResources.map((uri) => resolveReference(uri, filePath, root))]) {
      const bytes = await assertNonEmptyFile(referencedPath)
      if (path.extname(referencedPath).toLowerCase() === '.m3u8') {
        await visitPlaylist(referencedPath)
      } else {
        segments.push(referencedPath)
      }
      resources.push({ path: referencedPath, sizeBytes: bytes })
    }
    playlists.push({ path: filePath, sizeBytes, streamCount, segmentCount })
    visiting.delete(filePath)
    visited.add(filePath)
  }

  await visitPlaylist(master, true)
  return { masterPath: master, playlists, segments, resources }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function recoverHlsOutput(outputPath) {
  const parent = path.dirname(outputPath)
  const prefix = `${path.basename(outputPath)}.backup-`
  let backups = []
  try {
    backups = (await fs.readdir(parent)).filter((name) => name.startsWith(prefix)).sort().reverse()
  } catch {
    return false
  }

  const currentIsValid = await pathExists(path.join(outputPath, 'master.m3u8'))
    && await validateHls(path.join(outputPath, 'master.m3u8'), { outputRoot: outputPath }).then(() => true, () => false)
  if (currentIsValid) {
    await Promise.all(backups.map((name) => fs.rm(path.join(parent, name), { recursive: true, force: true })))
    return false
  }

  for (const name of backups) {
    const backupPath = path.join(parent, name)
    const valid = await validateHls(path.join(backupPath, 'master.m3u8'), { outputRoot: backupPath }).then(() => true, () => false)
    if (!valid) continue
    if (await pathExists(outputPath)) await fs.rm(outputPath, { recursive: true, force: true })
    await fs.rename(backupPath, outputPath)
    return true
  }
  return false
}

export async function promoteHlsOutput(stagingPath, outputPath) {
  await validateHls(path.join(stagingPath, 'master.m3u8'), { outputRoot: stagingPath })
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await recoverHlsOutput(outputPath)

  const backupPath = `${outputPath}.backup-${randomUUID()}`
  const hadPreviousOutput = await pathExists(outputPath)
  if (hadPreviousOutput) await fs.rename(outputPath, backupPath)
  try {
    await fs.rename(stagingPath, outputPath)
    await validateHls(path.join(outputPath, 'master.m3u8'), { outputRoot: outputPath })
  } catch (error) {
    if (await pathExists(outputPath)) await fs.rm(outputPath, { recursive: true, force: true })
    if (hadPreviousOutput && await pathExists(backupPath)) await fs.rename(backupPath, outputPath)
    throw error
  }
  if (hadPreviousOutput) await fs.rm(backupPath, { recursive: true, force: true })
}