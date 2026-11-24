import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { promoteHlsOutput, recoverHlsOutput, validateHls } from "./hls-validation.mjs"

const root = process.cwd()
const sourceRoot = path.join(root, "files")
const outputRoot = path.join(root, "video-processing", "output")
const metadataRoot = path.join(root, "video-processing", "metadata")
const segmentDuration = 6

// Bump whenever encoding settings change: outputs whose metadata records an
// older version are treated as stale and re-encoded (worker and CLI).
// v1: fixed bitrates up to 1080p. v2: CRF + source-aware caps, max 720p.
export const ENCODER_VERSION = 3

// videoBitrate is the *ceiling* (kbps). Each rendition is encoded with CRF for
// constant visual quality and capped at min(ceiling, source bitrate x headroom),
// so a low-bitrate source is never inflated into a much larger HLS.
// 1080p is intentionally off for now (storage/data cost); add it back here.
const profiles = [
  { name: "480p", width: 854, height: 480, videoBitrate: 1200, audioBitrate: 128 },
  { name: "720p", width: 1280, height: 720, videoBitrate: 2500, audioBitrate: 128 },
]

const videoCrf = 20
// Re-encoding loses a little quality each generation; allow some headroom
// above the source bitrate so the cap never becomes the visible bottleneck.
const sourceBitrateHeadroom = 1.5
const minimumVideoBitrate = 400
// O bitrate cresce menos que a area da imagem; expoente < 1 evita sufocar a qualidade menor.
const pixelScaleExponent = 0.75

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal, ...spawnOptions } = options
    const child = spawn(command, args, { windowsHide: true, ...spawnOptions })
    let stdout = ""
    let stderr = ""
    const abort = () => child.kill()
    if (signal?.aborted) {
      abort()
      reject(Object.assign(new Error("Processamento interrompido."), { name: "AbortError" }))
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", abort)
      reject(error)
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort)
      if (signal?.aborted) reject(Object.assign(new Error("Processamento interrompido."), { name: "AbortError" }))
      else if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} terminou com código ${code}\n${stderr.slice(-4000)}`))
    })
  })
}

async function ensureTools() {
  for (const tool of ["ffmpeg", "ffprobe"]) {
    try {
      await run(tool, ["-version"])
    } catch {
      throw new Error(`${tool} não encontrado no PATH. Instale FFmpeg e valide com: ${tool} -version`)
    }
  }
}

async function findVideos(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const videos = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) videos.push(...(await findVideos(fullPath)))
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4") videos.push(fullPath)
  }
  return videos.sort((first, second) => first.localeCompare(second, "pt-BR"))
}

async function probe(source) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,bit_rate:stream=index,codec_type,codec_name,width,height,bit_rate,r_frame_rate",
    "-of", "json",
    source,
  ])
  const data = JSON.parse(stdout)
  const video = data.streams?.find((stream) => stream.codec_type === "video")
  const audio = data.streams?.find((stream) => stream.codec_type === "audio")
  if (!video?.width || !video.height) throw new Error("O arquivo não possui um stream de vídeo válido")
  const totalBitrate = Number(data.format?.bit_rate ?? 0)
  const streamVideoBitrate = Number(video.bit_rate ?? 0)
  const audioStreamBitrate = Number(audio?.bit_rate ?? 0)
  return {
    duration: Number(data.format?.duration ?? 0),
    bitrate: totalBitrate,
    // Some containers omit the per-stream bitrate; fall back to total - audio.
    videoBitrate: streamVideoBitrate || Math.max(0, totalBitrate - audioStreamBitrate),
    width: video.width,
    height: video.height,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    audioBitrate: Number(audio?.bit_rate ?? 0),
    frameRate: video.r_frame_rate ?? null,
    hasAudio: Boolean(audio),
  }
}

function capToSource(ceilingKbps, info, profile) {
  const sourceKbps = Math.round((info.videoBitrate || info.bitrate || 0) / 1000)
  if (!sourceKbps) return ceilingKbps
  const sourcePixels = info.width * info.height
  const pixelRatio = sourcePixels > 0 ? Math.min(1, (profile.width * profile.height) / sourcePixels) : 1
  const scaledSourceKbps = sourceKbps * sourceBitrateHeadroom * pixelRatio ** pixelScaleExponent
  return Math.max(minimumVideoBitrate, Math.min(ceilingKbps, Math.round(scaledSourceKbps)))
}

export function selectProfiles(info) {
  const compatible = profiles.filter((profile) => info.width >= profile.width && info.height >= profile.height)
  if (compatible.length > 0) {
    return compatible.map((profile) => ({ ...profile, videoBitrate: capToSource(profile.videoBitrate, info, profile) }))
  }
  const original = { name: `${info.height}p`, width: info.width, height: info.height, audioBitrate: 128 }
  return [{ ...original, videoBitrate: capToSource(profiles[0].videoBitrate, info, original) }]
}

function parseMaster(masterPath) {
  return fs.readFile(masterPath, "utf8")
}

async function validateOutput(episodeOutput, selectedProfiles) {
  const masterPath = path.join(episodeOutput, "master.m3u8")
  const result = await validateHls(masterPath, { outputRoot: episodeOutput })
  for (const profile of selectedProfiles) {
    const playlistPath = path.join(episodeOutput, profile.name, "index.m3u8")
    if (!result.playlists.some((playlist) => playlist.path === playlistPath)) {
      throw new Error(`master.m3u8 não referencia ${profile.name}`)
    }
  }
}

export async function isComplete(metadataPath, sourceStat, episodeOutput, selectedProfiles) {
  let metadata = null
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"))
  } catch {
    // Metadata is advisory; a complete, valid canonical output can stand alone.
  }
  if (metadata?.status === "completed" && (metadata.sourceSize !== sourceStat.size || metadata.sourceModifiedAt !== sourceStat.mtime.toISOString())) return false
  if (metadata?.status === "completed" && metadata.encoderVersion !== ENCODER_VERSION) return false
  try {
    if (metadata?.status === "completed") await validateOutput(episodeOutput, selectedProfiles)
    else await validateHls(path.join(episodeOutput, "master.m3u8"), { outputRoot: episodeOutput })
    return true
  } catch {
    return false
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
}

async function encodeProfile(source, episodeOutput, profile, hasAudio, signal) {
  const profileOutput = path.join(episodeOutput, profile.name)
  await fs.rm(profileOutput, { recursive: true, force: true })
  await fs.mkdir(profileOutput, { recursive: true })
  const args = [
    "-y", "-i", source,
    "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0?"] : []),
    "-vf", `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    // "medium" + "animation" tune: noticeably better quality per byte on
    // cartoons than "veryfast", at the cost of a slower (one-off) encode.
    "-c:v", "libx264", "-preset", "medium", "-tune", "animation", "-profile:v", "main", "-pix_fmt", "yuv420p",
    "-crf", String(videoCrf), "-maxrate", `${profile.videoBitrate}k`, "-bufsize", `${profile.videoBitrate * 2}k`,
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    ...(hasAudio ? ["-c:a", "aac", "-b:a", `${profile.audioBitrate}k`, "-ac", "2"] : []),
    "-f", "hls", "-hls_time", String(segmentDuration), "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments", "-hls_segment_filename", path.join(profileOutput, "segment_%03d.ts"),
    path.join(profileOutput, "index.m3u8"),
  ]
  await run("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], signal })
}

export async function encodeEpisode(source, episodeOutput, { signal, onProgress = () => {} } = {}) {
  await ensureTools()
  const info = await probe(source)
  const selectedProfiles = selectProfiles(info)
  await fs.mkdir(episodeOutput, { recursive: true })
  for (const profile of selectedProfiles) {
    onProgress(profile.name)
    await encodeProfile(source, episodeOutput, profile, info.hasAudio, signal)
  }
  await createMaster(episodeOutput, selectedProfiles, info)
  await validateOutput(episodeOutput, selectedProfiles)
  const generatedFiles = await fs.readdir(episodeOutput, { recursive: true })
  const generatedSize = (await Promise.all(generatedFiles.map(async (file) => (await fs.stat(path.join(episodeOutput, file))).size))).reduce((sum, value) => sum + value, 0)
  return { info, selectedProfiles, generatedSize }
}

export function metadataPathForSource(source, projectRoot = root) {
  const relative = path.relative(path.join(projectRoot, 'files'), source)
  const showTitle = path.dirname(relative)
  const episodeName = path.basename(relative, path.extname(relative))
  const prefix = showTitle === "." ? "" : `${showTitle} - `
  return path.join(projectRoot, 'video-processing', 'metadata', `${prefix}${episodeName}.json`)
}

export async function writeEncodingMetadata({ source, episodeOutput, sourceStats, info, selectedProfiles, generatedSize, projectRoot = root }) {
  const metadataPath = metadataPathForSource(source, projectRoot)
  await fs.mkdir(path.dirname(metadataPath), { recursive: true })
  await fs.writeFile(metadataPath, `${JSON.stringify({
    status: "completed",
    encoderVersion: ENCODER_VERSION,
    source: path.relative(projectRoot, source),
    sourceSize: sourceStats.size,
    sourceModifiedAt: sourceStats.mtime.toISOString(),
    duration: info.duration,
    width: info.width,
    height: info.height,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    audioBitrate: info.audioBitrate,
    frameRate: info.frameRate,
    hasAudio: info.hasAudio,
    master: path.relative(projectRoot, path.join(episodeOutput, "master.m3u8")),
    qualities: selectedProfiles.map((profile) => profile.name),
    generatedSize,
    processedAt: new Date().toISOString(),
  }, null, 2)}\n`)
}

async function createMaster(episodeOutput, selectedProfiles, info) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
  for (const profile of selectedProfiles) {
    const bandwidth = (profile.videoBitrate + profile.audioBitrate) * 1000
    const codecs = info.hasAudio ? 'CODECS="avc1.4d401f,mp4a.40.2"' : 'CODECS="avc1.4d401f"'
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${profile.width}x${profile.height},${codecs}`)
    lines.push(`${profile.name}/index.m3u8`)
  }
  await fs.writeFile(path.join(episodeOutput, "master.m3u8"), `${lines.join("\n")}\n`)
}

async function main() {
  console.log("KidsPlay HLS Encoder\n")
  await ensureTools()
  const sources = await findVideos(sourceRoot)
  const metadata = []
  let processed = 0
  let skipped = 0
  let errors = 0
  let sourceBytes = 0
  let outputBytes = 0
  const startedAt = performance.now()
  console.log(`Encontrados: ${sources.length} vídeos\n`)

  for (const [index, source] of sources.entries()) {
    const relative = path.relative(sourceRoot, source)
    const parts = relative.split(path.sep)
    const showTitle = parts.slice(0, -1).join(path.sep)
    const episodeName = path.basename(source, path.extname(source))
    const episodeOutput = path.join(outputRoot, showTitle, episodeName)
    const metadataPath = metadataPathForSource(source)
    const sourceStat = await fs.stat(source)
    sourceBytes += sourceStat.size
    process.stdout.write(`[${index + 1}/${sources.length}] ${showTitle} - ${episodeName}\n`)

    let stagingPath = null
    try {
      const info = await probe(source)
      const selectedProfiles = selectProfiles(info)
      console.log(`Resolução: ${info.width}x${info.height} | Duração: ${formatDuration(info.duration)}`)
      console.log(`Qualidades: ${selectedProfiles.map((profile) => profile.name).join(", ")}`)
      await recoverHlsOutput(episodeOutput)
      if (await isComplete(metadataPath, sourceStat, episodeOutput, selectedProfiles)) {
        skipped += 1
        const existing = await fs.readdir(episodeOutput, { recursive: true })
        outputBytes += (await Promise.all(existing.map(async (file) => { try { return (await fs.stat(path.join(episodeOutput, file))).size } catch { return 0 } }))).reduce((sum, value) => sum + value, 0)
        console.log("Status: IGNORADO (já completo)\n")
        continue
      }
      await fs.mkdir(path.dirname(metadataPath), { recursive: true })
      await fs.mkdir(path.dirname(episodeOutput), { recursive: true })
      stagingPath = `${episodeOutput}.staging-${randomUUID()}`
      for (const profile of selectedProfiles) {
        process.stdout.write(`Gerando ${profile.name}...`)
        await encodeProfile(source, stagingPath, profile, info.hasAudio)
        console.log(" OK")
      }
      await createMaster(stagingPath, selectedProfiles, info)
      await validateOutput(stagingPath, selectedProfiles)
      await promoteHlsOutput(stagingPath, episodeOutput)
      const generatedFiles = await fs.readdir(episodeOutput, { recursive: true })
      const generatedBytes = (await Promise.all(generatedFiles.map(async (file) => (await fs.stat(path.join(episodeOutput, file))).size))).reduce((sum, value) => sum + value, 0)
      outputBytes += generatedBytes
      await writeEncodingMetadata({ source, episodeOutput, sourceStats: sourceStat, info, selectedProfiles, generatedSize: generatedBytes })
      processed += 1
      console.log("Status: OK\n")
    } catch (error) {
      if (stagingPath) await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      errors += 1
      console.error(`Status: ERRO\n${error instanceof Error ? error.message : error}\n`)
    }
  }

  console.log("=================================")
  console.log("KIDSPLAY HLS ENCODER")
  console.log("=================================")
  console.log(`Total: ${sources.length}`)
  console.log(`Processados: ${processed}`)
  console.log(`Ignorados: ${skipped}`)
  console.log(`Erros: ${errors}`)
  console.log(`MP4 original: ${formatBytes(sourceBytes)}`)
  console.log(`HLS gerado: ${formatBytes(outputBytes)}`)
  console.log(`Tempo total: ${formatDuration((performance.now() - startedAt) / 1000)}`)
  if (errors > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\nFalha da pipeline: ${error.message}`)
    process.exitCode = 1
  })
}
