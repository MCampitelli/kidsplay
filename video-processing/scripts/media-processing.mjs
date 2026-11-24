import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateShows } from '../../scripts/generate-shows.mjs'
import { ENCODER_VERSION, encodeEpisode, metadataPathForSource, writeEncodingMetadata } from './encode-videos.mjs'
import { promoteHlsOutput, recoverHlsOutput, validateHls } from './hls-validation.mjs'

const activeStatuses = new Set(['thumbnail', 'verifying-hls', 'converting-hls', 'validating-hls'])
const supportedStatuses = new Set([...activeStatuses, 'queued', 'completed', 'error'])

function invalidMediaPath(message) {
  throw Object.assign(new Error(message), { statusCode: 400 })
}

export function normalizeMp4Path(input, projectRoot) {
  if (typeof input !== 'string' || !input.trim()) invalidMediaPath('Informe o caminho do arquivo MP4.')
  const value = input.trim()
  const normalized = value.replace(/\\/g, '/')
  const filesRoot = path.resolve(projectRoot, 'files')
  let absolutePath
  let segments
  const isFilesPath = /^\/?files\//i.test(normalized)
  if (!isFilesPath && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value))) {
    absolutePath = path.resolve(value)
    const relativePath = path.relative(filesRoot, absolutePath)
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      invalidMediaPath('O caminho absoluto precisa apontar para um MP4 dentro da pasta files do projeto.')
    }
    segments = relativePath.split(path.sep)
  } else {
    segments = normalized.split('/').filter(Boolean).map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        invalidMediaPath('O caminho do MP4 contém codificação inválida.')
      }
    })
    if (segments.shift()?.toLowerCase() !== 'files') {
      invalidMediaPath('Use um caminho dentro de files ou cole o caminho absoluto do MP4.')
    }
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
      invalidMediaPath('O caminho do MP4 não é válido.')
    }
    absolutePath = path.resolve(filesRoot, ...segments)
  }
  if (path.extname(absolutePath).toLowerCase() !== '.mp4') invalidMediaPath('O arquivo informado precisa ter extensão .mp4.')

  return {
    absolutePath,
    relativePath: path.relative(filesRoot, absolutePath),
    assetPath: `/files/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
  }
}

export function stableEpisodeKey(relativeSourcePath) {
  const stablePath = relativeSourcePath.replace(/\\/g, '/').normalize('NFC').toLowerCase()
  return createHash('sha256').update(stablePath).digest('hex').slice(0, 32)
}

function thumbnailEpisodeKey(relativeSourcePath) {
  return createHash('sha256')
    .update(`${stableEpisodeKey(relativeSourcePath)}:thumbnail-40s`)
    .digest('hex')
    .slice(0, 32)
}

export function thumbnailFilePath(projectRoot, relativeSourcePath) {
  return path.join(projectRoot, 'video-processing', 'thumbnails', 'episodes', `${thumbnailEpisodeKey(relativeSourcePath)}.jpg`)
}

export function thumbnailPublicPath(relativeSourcePath) {
  return `/thumbnails/episodes/${thumbnailEpisodeKey(relativeSourcePath)}.jpg`
}

async function persistHlsOutputIndex(projectRoot, relativeSourcePath, masterPath) {
  const indexPath = path.join(projectRoot, 'video-processing', 'metadata', 'media-output-index.json')
  let index = {}
  try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  index[stableEpisodeKey(relativeSourcePath)] = path.relative(projectRoot, masterPath).split(path.sep).join('/')
  await fs.mkdir(path.dirname(indexPath), { recursive: true })
  const temporaryPath = `${indexPath}.tmp-${randomUUID()}`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, indexPath)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export function publicHlsPath(filePath, outputRoot) {
  const root = path.resolve(outputRoot)
  const absolutePath = path.resolve(filePath)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error('O HLS está fora da pasta de saída permitida.')
  }
  const relativePath = path.relative(root, absolutePath).split(path.sep).map(encodeURIComponent).join('/')
  return `/hls/${relativePath}`
}

function sourcePathFromAsset(assetPath, projectRoot) {
  return normalizeMp4Path(assetPath, projectRoot)
}

function registeredThumbnailPath(assetPath, projectRoot) {
  const value = String(assetPath || '').trim().replace(/\\/g, '/')
  const roots = [
    { prefix: '/files/', root: path.join(projectRoot, 'files') },
    { prefix: '/thumbnails/', root: path.join(projectRoot, 'video-processing', 'thumbnails') },
  ]
  const match = roots.find(({ prefix }) => value.startsWith(prefix))
  if (!match) return null
  let segments
  try { segments = value.slice(match.prefix.length).split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null
  const filePath = path.resolve(match.root, ...segments)
  if (filePath !== match.root && !filePath.startsWith(`${match.root}${path.sep}`)) return null
  return filePath
}

function outputPathFromSource(sourcePath, filesRoot, outputRoot) {
  const relativePath = path.relative(filesRoot, sourcePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('O arquivo fonte está fora de /files.')
  }
  const withoutExtension = relativePath.slice(0, -path.extname(relativePath).length)
  return path.join(outputRoot, withoutExtension, 'master.m3u8')
}

function masterPathForRegisteredAsset(assetPath, outputRoot) {
  const value = String(assetPath || '').trim().replace(/\\/g, '/')
  let segments
  if (value.startsWith('/hls/')) {
    segments = value.slice('/hls/'.length).split('/').filter(Boolean)
  } else if (value.startsWith('hls/')) {
    segments = value.slice('hls/'.length).split('/').filter(Boolean)
  } else if (value.startsWith('video-processing/output/')) {
    segments = value.slice('video-processing/output/'.length).split('/').filter(Boolean)
  } else {
    const absolutePath = path.resolve(value)
    const root = path.resolve(outputRoot)
    if (absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`)) {
      return masterPathFromPlaylist(absolutePath)
    }
    return null
  }

  try {
    segments = segments.map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return masterPathFromPlaylist(path.resolve(outputRoot, ...segments))
}

function masterPathFromPlaylist(filePath) {
  if (path.basename(filePath).toLowerCase() === 'master.m3u8') return filePath
  if (path.basename(filePath).toLowerCase() === 'index.m3u8') {
    return path.join(path.dirname(path.dirname(filePath)), 'master.m3u8')
  }
  return filePath
}

async function registeredHlsMatchesSource(masterPath, canonicalMaster, sourcePath, sourceStats, projectRoot) {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPathForSource(sourcePath, projectRoot), 'utf8'))
    const recordedSource = path.resolve(projectRoot, metadata.source)
    const recordedMaster = path.resolve(projectRoot, metadata.master)
    if (recordedSource !== path.resolve(sourcePath) || recordedMaster !== path.resolve(masterPath)) {
      return path.resolve(masterPath) === path.resolve(canonicalMaster) && metadata.status !== 'completed'
    }
    return metadata.status !== 'completed'
      || (metadata.sourceSize === sourceStats.size
        && metadata.sourceModifiedAt === sourceStats.mtime.toISOString()
        && metadata.encoderVersion === ENCODER_VERSION)
  } catch {
    return path.resolve(masterPath) === path.resolve(canonicalMaster)
  }
}

export function runMediaCommand(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const abort = () => child.kill()
    if (signal?.aborted) {
      abort()
      reject(Object.assign(new Error('Processamento interrompido.'), { name: 'AbortError' }))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) {
        reject(Object.assign(new Error('Processamento interrompido.'), { name: 'AbortError' }))
      } else if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${command} terminou com código ${code}\n${stderr.slice(-4000)}`))
      }
    })
  })
}

async function validJpeg(filePath, run = runMediaCommand) {
  try {
    const data = await fs.readFile(filePath)
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data.at(-2) !== 0xff || data.at(-1) !== 0xd9) return false
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', filePath,
    ])
    const stream = JSON.parse(stdout).streams?.[0]
    return stream?.codec_name === 'mjpeg' && Number(stream.width) > 0 && Number(stream.height) > 0
  } catch {
    return false
  }
}

async function getVideoDuration(sourcePath, run, signal) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath,
  ], { signal })
  const duration = Number.parseFloat(stdout.trim())
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

async function replaceFileSafely(stagingPath, outputPath) {
  const backupPath = `${outputPath}.backup-${randomUUID()}`
  let hadPreviousFile = false
  try {
    await fs.rename(outputPath, backupPath)
    hadPreviousFile = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await fs.rename(stagingPath, outputPath)
  } catch (error) {
    if (hadPreviousFile) await fs.rename(backupPath, outputPath)
    throw error
  }
  if (hadPreviousFile) await fs.rm(backupPath, { force: true })
}

export async function ensureEpisodeThumbnail(sourcePath, outputPath, { run = runMediaCommand, signal } = {}) {
  if (await validJpeg(outputPath, run)) return { created: false }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const stagingPath = `${outputPath}.tmp-${randomUUID()}.jpg`
  let duration = null
  try {
    duration = await getVideoDuration(sourcePath, run, signal)
  } catch {
    // The primary 40-second extraction is still attempted when probing fails.
  }
  const seeks = [40]
  if (duration !== null) seeks.push(Math.max(0, Math.min(duration * 0.5, duration - 0.04)), 0)
  else seeks.push(0)
  let lastError = null
  try {
    for (const seek of [...new Set(seeks)]) {
      await fs.rm(stagingPath, { force: true })
      try {
        await run('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-ss', String(seek), '-i', sourcePath,
          '-frames:v', '1', '-q:v', '2', '-y', stagingPath,
        ], { signal })
        if (await validJpeg(stagingPath, run)) {
          await replaceFileSafely(stagingPath, outputPath)
          return { created: true, seek }
        }
        lastError = new Error(`FFmpeg não gerou uma imagem JPG válida no segundo ${seek}.`)
      } catch (error) {
        if (signal?.aborted) throw error
        lastError = error
      }
    }
    throw new Error(`Não foi possível gerar a thumbnail: ${lastError?.message || 'nenhum frame válido encontrado.'}`)
  } finally {
    await fs.rm(stagingPath, { force: true }).catch(() => undefined)
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export class MediaProcessingQueue {
  constructor({ projectRoot, repository, onChange = () => {}, encode = encodeEpisode, run = runMediaCommand }) {
    this.projectRoot = path.resolve(projectRoot)
    this.repository = repository
    this.onChange = onChange
    this.encode = encode
    this.run = run
    this.metadataRoot = path.join(this.projectRoot, 'video-processing', 'metadata')
    this.journalPath = path.join(this.metadataRoot, 'media-processing.jsonl')
    this.lockPath = path.join(this.metadataRoot, 'media-processing.lock')
    this.jobs = new Map()
    this.writeChain = Promise.resolve()
    this.hasWorkerLock = false
    this.stopping = false
    this.running = false
    this.runningPromise = null
    this.timer = null
  }

  async initialize() {
    await fs.mkdir(this.metadataRoot, { recursive: true })
    await this.refreshJournal()
    this.hasWorkerLock = await this.acquireWorkerLock()
    if (this.hasWorkerLock) {
      for (const job of this.jobs.values()) {
        if (!activeStatuses.has(job.status)) continue
        await this.updateJob(job.episodeId, 'queued', 'Trabalho interrompido recuperado para nova tentativa.')
      }
      void this.pump()
    }
    this.timer = setInterval(() => { void this.tick() }, 1000)
    this.timer.unref?.()
  }

  async acquireWorkerLock() {
    const token = randomUUID()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await fs.open(this.lockPath, 'wx')
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }))
        await handle.close()
        this.lockToken = token
        return true
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        let existing = null
        try { existing = JSON.parse(await fs.readFile(this.lockPath, 'utf8')) } catch { /* Recover malformed stale locks below. */ }
        if (existing && isProcessAlive(existing.pid)) return false
        if (!existing) {
          const stats = await fs.stat(this.lockPath).catch(() => null)
          if (stats && Date.now() - stats.mtimeMs < 30_000) return false
        }
        await fs.rm(this.lockPath, { force: true })
      }
    }
    return false
  }

  async releaseWorkerLock() {
    if (!this.lockToken) return
    try {
      const lock = JSON.parse(await fs.readFile(this.lockPath, 'utf8'))
      if (lock.token === this.lockToken) await fs.rm(this.lockPath, { force: true })
    } catch {
      // A newer process may already own the lock.
    }
    this.lockToken = null
  }

  async refreshJournal() {
    let content
    try { content = await fs.readFile(this.journalPath, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    const latest = new Map()
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const job = JSON.parse(line)
        if (Number.isSafeInteger(job.episodeId) && supportedStatuses.has(job.status)) latest.set(job.episodeId, job)
      } catch {
        // Ignore a truncated final line after an interrupted write.
      }
    }
    for (const [episodeId, job] of latest) this.jobs.set(episodeId, job)
  }

  async persist(job) {
    const serialized = `${JSON.stringify(job)}\n`
    this.writeChain = this.writeChain.then(() => fs.appendFile(this.journalPath, serialized, 'utf8'))
    await this.writeChain
    this.onChange(this.getJobs())
  }

  async updateJob(episodeId, status, message, extra = {}) {
    const previous = this.jobs.get(episodeId) || { episodeId, createdAt: new Date().toISOString(), attempts: 0 }
    const job = {
      ...previous,
      ...extra,
      episodeId,
      status,
      message,
      updatedAt: new Date().toISOString(),
    }
    this.jobs.set(episodeId, job)
    await this.persist(job)
    return job
  }

  getJobs() {
    return [...this.jobs.values()].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
  }

  getJob(episodeId) {
    return this.jobs.get(Number(episodeId)) || null
  }

  async enqueue(episodeId, { force = false } = {}) {
    const id = Number(episodeId)
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Episódio inválido para processamento.')
    await this.refreshJournal()
    const current = this.jobs.get(id)
    if (current && (current.status === 'queued' || activeStatuses.has(current.status))) return current
    if (current?.status === 'completed' && !force) return current
    const job = await this.updateJob(id, 'queued', 'Aguardando processamento.', {
      attempts: (current?.attempts || 0) + 1,
      error: null,
      completedAt: null,
    })
    void this.pump()
    return job
  }

  async enqueuePending() {
    await this.refreshJournal()
    const records = await this.repository.listMp4Assets()
    let queued = 0
    for (const record of records) {
      const existing = this.jobs.get(Number(record.episodeId))
      if (existing && (existing.status === 'queued' || activeStatuses.has(existing.status))) continue
      await this.enqueue(record.episodeId, { force: true })
      queued += 1
    }
    return { queued, total: records.length }
  }

  async tick() {
    if (this.stopping) return
    await this.refreshJournal().catch(() => undefined)
    if (!this.hasWorkerLock) {
      this.hasWorkerLock = await this.acquireWorkerLock().catch(() => false)
      if (this.hasWorkerLock) {
        for (const job of this.jobs.values()) {
          if (activeStatuses.has(job.status)) await this.updateJob(job.episodeId, 'queued', 'Trabalho interrompido recuperado para nova tentativa.')
        }
      }
    }
    if (this.hasWorkerLock) void this.pump()
  }

  async pump() {
    if (!this.hasWorkerLock || this.running || this.stopping) return this.runningPromise
    this.running = true
    this.runningPromise = (async () => {
      try {
        while (!this.stopping) {
          await this.refreshJournal()
          const job = [...this.jobs.values()]
            .filter((item) => item.status === 'queued')
            .sort((first, second) => first.createdAt.localeCompare(second.createdAt))[0]
          if (!job) break
          await this.runJob(job)
        }
      } finally {
        this.running = false
      }
    })()
    await this.runningPromise
  }

  async runJob(job) {
    const abortController = new AbortController()
    this.abortController = abortController
    try {
      const result = await processEpisodeMedia({
        episodeId: job.episodeId,
        repository: this.repository,
        projectRoot: this.projectRoot,
        signal: abortController.signal,
        run: this.run,
        encode: this.encode,
        updateStatus: (status, message, extra) => this.updateJob(job.episodeId, status, message, extra),
      })
      const current = this.jobs.get(job.episodeId)
      await this.updateJob(job.episodeId, result.error ? 'error' : 'completed', result.error || 'MP4, thumbnail e HLS prontos.', {
        sourceSize: result.sourceSize,
        sourceModifiedAt: result.sourceModifiedAt,
        thumbnailPath: result.thumbnailPath,
        hlsPath: result.hlsPath,
        error: result.error || null,
        completedAt: result.error ? null : new Date().toISOString(),
        attempts: current?.attempts || job.attempts || 1,
      })
    } catch (error) {
      if (this.stopping || abortController.signal.aborted) {
        await this.updateJob(job.episodeId, 'queued', 'Interrompido pelo encerramento; será retomado ao iniciar o Controle.')
      } else {
        await this.updateJob(job.episodeId, 'error', error instanceof Error ? error.message : String(error), { error: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      this.abortController = null
    }
  }

  async stop() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.abortController?.abort()
    await this.runningPromise?.catch(() => undefined)
    await this.releaseWorkerLock()
  }
}

export async function processEpisodeMedia({ episodeId, repository, projectRoot, signal, run = runMediaCommand, encode = encodeEpisode, updateStatus = async () => {} }) {
  const context = await repository.getEpisodeMedia(episodeId)
  if (!context?.mp4Path) throw new Error('Nenhum arquivo MP4 está registrado para este episódio.')

  const { absolutePath: sourcePath, relativePath } = sourcePathFromAsset(context.mp4Path, projectRoot)
  let sourceStats
  try {
    sourceStats = await fs.stat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.size === 0) throw new Error('O MP4 não existe ou está vazio.')
  } catch (error) {
    await repository.setMp4Availability(episodeId, context.mp4Path, false, null)
    throw new Error(`MP4 indisponível: ${error.message}`)
  }
  await repository.setMp4Availability(episodeId, context.mp4Path, true, sourceStats.size)

  const thumbPath = thumbnailFilePath(projectRoot, relativePath)
  let thumbnailError = null
  const thumbPublicPath = thumbnailPublicPath(relativePath)
  await updateStatus('thumbnail', 'Verificando thumbnail do episódio.')
  try {
    const existingThumbPath = registeredThumbnailPath(context.thumbnailPath, projectRoot)
    const reusedThumbnail =
      context.thumbnailPath === thumbPublicPath &&
      existingThumbPath &&
      await validJpeg(existingThumbPath, run)
    if (!reusedThumbnail) {
      await ensureEpisodeThumbnail(sourcePath, thumbPath, { run, signal })
    }
    await repository.setThumbnailPath(episodeId, thumbPublicPath)
    await updateStatus(
      'thumbnail',
      reusedThumbnail ? 'Thumbnail válida reutilizada.' : 'Thumbnail JPG pronta.',
      { thumbnailPath: thumbPublicPath },
    )
  } catch (error) {
    if (signal?.aborted) throw error
    thumbnailError = error instanceof Error ? error.message : String(error)
  }

  await updateStatus('verifying-hls', 'Verificando HLS cadastrado e saída local.')
  const outputRoot = path.join(projectRoot, 'video-processing', 'output')
  const canonicalMaster = outputPathFromSource(sourcePath, path.join(projectRoot, 'files'), outputRoot)
  const candidates = []
  for (const asset of context.hlsAssets || []) {
    const candidate = masterPathForRegisteredAsset(asset.path, outputRoot)
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate)
  }
  if (!candidates.includes(canonicalMaster)) candidates.push(canonicalMaster)

  let validHls = null
  const validationErrors = []
  for (const candidate of candidates) {
    try {
      if (!await registeredHlsMatchesSource(candidate, canonicalMaster, sourcePath, sourceStats, projectRoot)) {
        throw new Error('O HLS registrado não pode ser associado com segurança ao MP4 deste episódio.')
      }
      await recoverHlsOutput(path.dirname(candidate))
      const validation = await validateHls(candidate, { outputRoot })
      validHls = { masterPath: candidate, validation }
      break
    } catch (error) {
      validationErrors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (!validHls) {
    await repository.markHlsUnavailable(episodeId)
    const stagingPath = `${path.dirname(canonicalMaster)}.staging-${episodeId}-${randomUUID()}`
    let encoding = null
    try {
      await updateStatus('converting-hls', 'HLS ausente ou inválido; convertendo para staging seguro.')
      encoding = await encode(sourcePath, stagingPath, {
        signal,
        onProgress: (profile) => updateStatus('converting-hls', `Convertendo HLS: ${profile}.`),
      })
      await updateStatus('validating-hls', 'Validando playlists e segmentos gerados.')
      await validateHls(path.join(stagingPath, 'master.m3u8'), { outputRoot: stagingPath })
      await promoteHlsOutput(stagingPath, path.dirname(canonicalMaster))
      const validation = await validateHls(canonicalMaster, { outputRoot })
      validHls = { masterPath: canonicalMaster, validation }
      if (encoding?.info) {
        await writeEncodingMetadata({
          episodeId,
          episodeOutput: path.dirname(canonicalMaster),
          source: sourcePath,
          sourceStats,
          info: encoding.info,
          selectedProfiles: encoding.selectedProfiles,
          generatedSize: encoding.generatedSize,
          projectRoot,
        })
      }
    } catch (error) {
      await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      if (signal?.aborted) throw error
      await generateShows(projectRoot).catch((refreshError) => {
        validationErrors.push(`Não foi possível atualizar o catálogo do player: ${refreshError.message}`)
      })
      const details = validationErrors.length ? ` HLS anterior: ${validationErrors.at(-1)}` : ''
      throw new Error(`Falha ao gerar HLS: ${error instanceof Error ? error.message : error}.${details}`)
    }
  }

  const hlsAssets = assetsFromValidation(validHls.masterPath, validHls.validation, outputRoot)
  await repository.syncHlsAssets(episodeId, hlsAssets)
  await persistHlsOutputIndex(projectRoot, relativePath, validHls.masterPath)
  const hlsPath = publicHlsPath(validHls.masterPath, outputRoot)
  await generateShows(projectRoot)
  return {
    sourceSize: sourceStats.size,
    sourceModifiedAt: sourceStats.mtime.toISOString(),
    thumbnailPath: thumbnailError ? null : thumbPublicPath,
    hlsPath,
    error: thumbnailError,
  }
}

function assetsFromValidation(masterPath, validation, outputRoot) {
  const assets = [{
    format: 'hls', quality: 'master', path: publicHlsPath(masterPath, outputRoot),
    sizeBytes: validation.playlists.find((playlist) => playlist.path === masterPath)?.sizeBytes ?? null,
  }]
  const seen = new Set(['master'])
  for (const playlist of validation.playlists) {
    if (playlist.path === masterPath) continue
    const quality = path.basename(path.dirname(playlist.path)).slice(0, 16)
    if (!quality || seen.has(quality)) continue
    seen.add(quality)
    assets.push({ format: 'hls', quality, path: publicHlsPath(playlist.path, outputRoot), sizeBytes: playlist.sizeBytes })
  }
  return assets
}
