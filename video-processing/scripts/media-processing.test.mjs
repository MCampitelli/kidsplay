import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { generateShows } from '../../scripts/generate-shows.mjs'
import { encodeEpisode, isComplete } from './encode-videos.mjs'
import {
  ensureEpisodeThumbnail,
  MediaProcessingQueue,
  normalizeMp4Path,
  processEpisodeMedia,
  stableEpisodeKey,
  thumbnailFilePath,
  thumbnailPublicPath,
} from './media-processing.mjs'
import { validateHls } from './hls-validation.mjs'

const ffmpegAvailable = await commandAvailable('ffmpeg') && await commandAvailable('ffprobe')
const ffmpegOptions = { skip: !ffmpegAvailable ? 'FFmpeg e FFprobe não estão disponíveis no PATH.' : false }
const episodeId = 41
const relativeSource = path.join('Camundongos Aventureiros', 'O Rato Touchê - teste.mp4')

async function commandAvailable(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

async function createProject(t, { createSource = true, file = relativeSource, duration = 6.5 } = {}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kidsplay-media-test-'))
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }))
  const sourcePath = path.join(projectRoot, 'files', file)
  const relativePath = path.relative(path.join(projectRoot, 'files'), sourcePath)
  const mp4AssetPath = `/files/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`
  if (createSource) {
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=320x180:r=12:d=${duration}`,
      '-f', 'lavfi', '-i', `sine=frequency=1000:sample_rate=44100:duration=${duration}`, '-shortest',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', sourcePath,
    ])
  }
  const repository = createRepository(mp4AssetPath)
  return { projectRoot, sourcePath, relativePath, mp4AssetPath, repository }
}

function createRepository(mp4Path) {
  const state = {
    mp4Path,
    mp4Available: null,
    mp4Size: null,
    thumbnailPath: null,
    hlsAssets: [],
    availabilityUpdates: 0,
    syncCount: 0,
    readCount: 0,
  }
  return {
    state,
    async getEpisodeMedia(id) {
      assert.equal(id, episodeId)
      state.readCount += 1
      return { mp4Path: state.mp4Path, thumbnailPath: state.thumbnailPath, hlsAssets: [...state.hlsAssets] }
    },
    async setMp4Availability(id, assetPath, available, sizeBytes) {
      assert.equal(id, episodeId)
      assert.equal(assetPath, state.mp4Path)
      state.mp4Available = available
      state.mp4Size = sizeBytes
      state.availabilityUpdates += 1
    },
    async setThumbnailPath(id, value) {
      assert.equal(id, episodeId)
      state.thumbnailPath = value
    },
    async markHlsUnavailable(id) {
      assert.equal(id, episodeId)
      state.hlsAssets = state.hlsAssets.map((asset) => ({ ...asset, available: false }))
    },
    async syncHlsAssets(id, assets) {
      assert.equal(id, episodeId)
      state.hlsAssets = assets.map((asset) => ({ ...asset, available: true }))
      state.syncCount += 1
    },
    async listMp4Assets() {
      return [{ episodeId }]
    },
  }
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-3000))))
  })
}

async function createValidHls(directory) {
  const qualityDirectory = path.join(directory, '180p')
  await fs.mkdir(qualityDirectory, { recursive: true })
  await fs.writeFile(path.join(qualityDirectory, 'segment_000.ts'), Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00]))
  await fs.writeFile(path.join(qualityDirectory, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1.0,\nsegment_000.ts\n#EXT-X-ENDLIST\n')
  await fs.writeFile(path.join(directory, 'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n180p/index.m3u8\n')
}

async function processMedia(fixture, options = {}) {
  return processEpisodeMedia({
    episodeId,
    repository: fixture.repository,
    projectRoot: fixture.projectRoot,
    ...options,
  })
}

function outputDirectory(fixture) {
  const withoutExtension = fixture.relativePath.slice(0, -path.extname(fixture.relativePath).length)
  return path.join(fixture.projectRoot, 'video-processing', 'output', withoutExtension)
}

test('encoder reconhece HLS válido sem metadata e não pede nova conversão', async (t) => {
  const fixture = await createProject(t, { createSource: false })
  const output = outputDirectory(fixture)
  const metadata = path.join(fixture.projectRoot, 'video-processing', 'metadata', 'missing.json')
  await createValidHls(output)
  assert.equal(await isComplete(metadata, { size: 20, mtime: new Date() }, output, []), true)
})

test('catálogo publica caminho HLS indexado fora da convenção quando ele é válido', async (t) => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kidsplay-index-test-'))
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }))
  const showName = 'Histórias & Mais'
  const episodeName = 'Um título'
  const relativeSource = `${showName}/${episodeName}.mp4`
  const showDirectory = path.join(projectRoot, 'files', showName)
  const hlsDirectory = path.join(projectRoot, 'video-processing', 'output', 'reused-location')
  await fs.mkdir(showDirectory, { recursive: true })
  await fs.writeFile(path.join(showDirectory, 'capa.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  await fs.writeFile(path.join(showDirectory, `${episodeName}.mp4`), 'fixture')
  await createValidHls(hlsDirectory)
  await fs.mkdir(path.join(projectRoot, 'video-processing', 'metadata'), { recursive: true })
  await fs.writeFile(
    path.join(projectRoot, 'video-processing', 'metadata', 'media-output-index.json'),
    JSON.stringify({ [stableEpisodeKey(relativeSource)]: 'video-processing/output/reused-location/master.m3u8' }),
  )
  const shows = await generateShows(projectRoot)
  assert.equal(shows[0].episodes[0].hls, '/hls/reused-location/master.m3u8')
})

test('MP4 sem thumbnail/HLS gera os dois, sem depender do painel para vídeo', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  const result = await processMedia(fixture)
  const thumbPath = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  const validation = await validateHls(path.join(outputDirectory(fixture), 'master.m3u8'), {
    outputRoot: path.join(fixture.projectRoot, 'video-processing', 'output'),
  })
  assert.equal(fixture.repository.state.mp4Available, true)
  assert.equal(fixture.repository.state.thumbnailPath, thumbnailPublicPath(fixture.relativePath))
  assert.equal(result.hlsPath.endsWith('/master.m3u8'), true)
  assert.ok(validation.segments.length > 0)
  assert.equal((await fs.readFile(thumbPath)).subarray(0, 2).toString('hex'), 'ffd8')
})

test('thumbnail ausente com HLS completo gera imagem e reutiliza HLS sem converter', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  await processMedia(fixture)
  const thumbPath = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  await fs.rm(thumbPath)
  fixture.repository.state.thumbnailPath = null
  fixture.repository.state.hlsAssets = []
  let conversions = 0
  await processMedia(fixture, { encode: async () => { conversions += 1; throw new Error('não deveria converter') } })
  assert.equal(conversions, 0)
  assert.equal(fixture.repository.state.thumbnailPath, thumbnailPublicPath(fixture.relativePath))
  assert.ok((await fs.stat(thumbPath)).size > 100)
})

test('thumbnail e HLS válidos são preservados sem conversão', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  await processMedia(fixture)
  const thumbPath = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  const beforeThumb = await fs.stat(thumbPath)
  const beforeMaster = await fs.readFile(path.join(outputDirectory(fixture), 'master.m3u8'))
  let conversions = 0
  await processMedia(fixture, { encode: async () => { conversions += 1; throw new Error('não deveria converter') } })
  const afterThumb = await fs.stat(thumbPath)
  assert.equal(conversions, 0)
  assert.equal(afterThumb.mtimeMs, beforeThumb.mtimeMs)
  assert.deepEqual(await fs.readFile(path.join(outputDirectory(fixture), 'master.m3u8')), beforeMaster)
})

test('vídeo com menos de 40 segundos usa um frame alternativo válido', ffmpegOptions, async (t) => {
  const fixture = await createProject(t, { duration: 2.5 })
  const thumbnail = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  const result = await ensureEpisodeThumbnail(fixture.sourcePath, thumbnail)
  assert.ok(result.seek < 40)
  assert.ok((await fs.stat(thumbnail)).size > 100)
})

test('thumbnail de vídeo longo é capturada aos 40 segundos', ffmpegOptions, async (t) => {
  const fixture = await createProject(t, { duration: 42 })
  const thumbnail = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  const result = await ensureEpisodeThumbnail(fixture.sourcePath, thumbnail)
  assert.equal(result.seek, 40)
  assert.ok((await fs.stat(thumbnail)).size > 100)
})

test('thumbnail registrada na versão anterior é substituída', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  await processMedia(fixture)
  const legacyKey = stableEpisodeKey(fixture.relativePath)
  const legacyPath = path.join(
    fixture.projectRoot,
    'video-processing',
    'thumbnails',
    'episodes',
    `${legacyKey}.jpg`,
  )
  await fs.copyFile(thumbnailFilePath(fixture.projectRoot, fixture.relativePath), legacyPath)
  fixture.repository.state.thumbnailPath = `/thumbnails/episodes/${legacyKey}.jpg`
  await fs.rm(thumbnailFilePath(fixture.projectRoot, fixture.relativePath))

  await processMedia(fixture, { encode: async () => { throw new Error('não deveria converter') } })

  assert.equal(fixture.repository.state.thumbnailPath, thumbnailPublicPath(fixture.relativePath))
  assert.ok((await fs.stat(thumbnailFilePath(fixture.projectRoot, fixture.relativePath))).size > 100)
})

test('HLS incompleto é detectado e substituído somente após regeneração válida', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  await processMedia(fixture)
  const outputRoot = path.join(fixture.projectRoot, 'video-processing', 'output')
  const masterPath = path.join(outputDirectory(fixture), 'master.m3u8')
  const previous = await validateHls(masterPath, { outputRoot })
  await fs.rm(previous.segments[0])
  let conversions = 0
  await processMedia(fixture, { encode: async (...args) => { conversions += 1; return encodeEpisode(...args) } })
  assert.equal(conversions, 1)
  const regenerated = await validateHls(masterPath, { outputRoot })
  assert.ok(regenerated.segments.length > 0)
  assert.equal((await fs.readdir(path.dirname(masterPath))).some((name) => name.includes('.backup-')), false)
})

test('MP4 inexistente mantém o registro e grava disponibilidade falsa', ffmpegOptions, async (t) => {
  const fixture = await createProject(t, { createSource: false, file: 'Vídeos faltantes/Episódio.mp4' })
  await assert.rejects(processMedia(fixture), /MP4 indisponível/)
  assert.equal(fixture.repository.state.mp4Path, fixture.mp4AssetPath)
  assert.equal(fixture.repository.state.mp4Available, false)
  assert.equal(fixture.repository.state.availabilityUpdates, 1)
})

test('duas solicitações para o mesmo episódio usam uma única execução', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  const thumbPath = thumbnailFilePath(fixture.projectRoot, fixture.relativePath)
  await ensureEpisodeThumbnail(fixture.sourcePath, thumbPath)
  fixture.repository.state.thumbnailPath = thumbnailPublicPath(fixture.relativePath)
  let conversions = 0
  let activeConversions = 0
  let maxActiveConversions = 0
  const encode = async (_source, stagingPath) => {
    conversions += 1
    activeConversions += 1
    maxActiveConversions = Math.max(maxActiveConversions, activeConversions)
    await new Promise((resolve) => setTimeout(resolve, 80))
    await createValidHls(stagingPath)
    activeConversions -= 1
    return { info: null, selectedProfiles: [], generatedSize: 0 }
  }
  const first = new MediaProcessingQueue({ projectRoot: fixture.projectRoot, repository: fixture.repository, encode })
  const second = new MediaProcessingQueue({ projectRoot: fixture.projectRoot, repository: fixture.repository, encode })
  await first.initialize()
  await second.initialize()
  assert.equal(first.hasWorkerLock, true)
  assert.equal(second.hasWorkerLock, false)
  try {
    await Promise.all([first.enqueue(episodeId, { force: true }), second.enqueue(episodeId, { force: true })])
    await first.runningPromise
    assert.equal(conversions, 1)
    assert.equal(maxActiveConversions, 1)
    await second.refreshJournal()
    assert.equal(second.getJob(episodeId).status, 'completed')
  } finally {
    await second.stop()
    await first.stop()
  }
})

test('falha de conversão preserva MP4/saída anterior e permite retry', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  const outputDirectoryPath = outputDirectory(fixture)
  await fs.mkdir(outputDirectoryPath, { recursive: true })
  const originalMaster = '#EXTM3U\n# saída incompleta anterior\n'
  await fs.writeFile(path.join(outputDirectoryPath, 'master.m3u8'), originalMaster)
  fixture.repository.state.hlsAssets = [{ quality: 'master', path: `/hls/${fixture.relativePath.replace(/\\/g, '/').replace(/\.mp4$/i, '')}/master.m3u8` }]
  await assert.rejects(processMedia(fixture, { encode: async () => { throw new Error('falha simulada') } }), /Falha ao gerar HLS/)
  assert.equal(await fs.readFile(path.join(outputDirectoryPath, 'master.m3u8'), 'utf8'), originalMaster)
  assert.equal(fixture.repository.state.mp4Available, true)
  await processMedia(fixture)
  const validation = await validateHls(path.join(outputDirectoryPath, 'master.m3u8'), {
    outputRoot: path.join(fixture.projectRoot, 'video-processing', 'output'),
  })
  assert.ok(validation.segments.length > 0)
})

test('falha de conversão não remove um HLS anterior válido', ffmpegOptions, async (t) => {
  const fixture = await createProject(t)
  await processMedia(fixture)
  const outputDirectoryPath = outputDirectory(fixture)
  const masterPath = path.join(outputDirectoryPath, 'master.m3u8')
  const outputRoot = path.join(fixture.projectRoot, 'video-processing', 'output')
  const previousMaster = await fs.readFile(masterPath)
  const previous = await validateHls(masterPath, { outputRoot })
  await fs.appendFile(fixture.sourcePath, 'changed-source-version')
  await assert.rejects(processMedia(fixture, { encode: async () => { throw new Error('falha simulada') } }), /Falha ao gerar HLS/)
  assert.deepEqual(await fs.readFile(masterPath), previousMaster)
  for (const segment of previous.segments) assert.ok((await fs.stat(segment)).size > 0)
  assert.equal(fixture.repository.state.mp4Available, true)
})

test('caminhos com espaços e caracteres acentuados mantêm o vínculo do MP4', ffmpegOptions, async (t) => {
  const fixture = await createProject(t, { file: relativeSource })
  const normalized = normalizeMp4Path(fixture.mp4AssetPath, fixture.projectRoot)
  assert.equal(normalized.absolutePath, fixture.sourcePath)
  assert.match(normalized.assetPath, /Camundongos%20Aventureiros/)
  assert.match(normalized.assetPath, /Touch%C3%AA/)
  const result = await processMedia(fixture)
  assert.equal(fixture.repository.state.mp4Path, fixture.mp4AssetPath)
  assert.ok((await fs.stat(thumbnailFilePath(fixture.projectRoot, fixture.relativePath))).size > 100)
  assert.equal(result.hlsPath.includes('Camundongos%20Aventureiros'), true)
})

test('caminho absoluto do Windows é aceito somente dentro de files', async (t) => {
  const fixture = await createProject(t, { createSource: false })
  const normalized = normalizeMp4Path(fixture.sourcePath, fixture.projectRoot)
  assert.equal(normalized.absolutePath, fixture.sourcePath)
  assert.equal(normalized.assetPath, fixture.mp4AssetPath)
  assert.throws(
    () => normalizeMp4Path(path.join(fixture.projectRoot, 'outside.mp4'), fixture.projectRoot),
    /dentro da pasta files/,
  )
})
