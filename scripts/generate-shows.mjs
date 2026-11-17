import { createHash } from "node:crypto"

import fs from "node:fs"

import path from "node:path"

import { pathToFileURL } from "node:url"

import { validateHls } from "../video-processing/scripts/hls-validation.mjs"

const colors = [
  "#FF6B6B",
  "#FF9F43",
  "#4ECDC4",
  "#C77DFF",
  "#6BCB77",
  "#FFD93D",
]

const imageExtensions = new Set([".png", ".jpg", ".jpeg"])

function titleFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, "")
}

function urlPath(...parts) {
  return `/${parts.map((part) => encodeURIComponent(part)).join("/")}`
}

async function findHlsMasterUrl(
  showTitle,
  episodeTitle,
  hlsOutputDirectory,
  indexedHlsPath,
) {
  const outputRoot = path.resolve(hlsOutputDirectory)

  const candidates = []

  if (indexedHlsPath) candidates.push(indexedHlsPath)

  const canonicalPath = path.join(
    outputRoot,
    showTitle,
    episodeTitle,
    "master.m3u8",
  )

  if (!candidates.includes(canonicalPath)) candidates.push(canonicalPath)

  for (const masterPath of candidates) {
    const resolved = path.resolve(masterPath)

    if (
      !resolved.startsWith(`${outputRoot}${path.sep}`) ||
      path.basename(resolved).toLowerCase() !== "master.m3u8" ||
      !fs.existsSync(resolved)
    )
      continue

    try {
      await validateHls(resolved, { outputRoot })

      return urlPath(
        "hls",
        ...path.relative(outputRoot, resolved).split(path.sep),
      )
    } catch (error) {
      console.warn(
        `[KidsPlay] HLS inválido ignorado (${showTitle} - ${episodeTitle}): ${error.message}`,
      )
    }
  }

  return undefined
}

function stableEpisodeKey(relativeSourcePath) {
  const stablePath = relativeSourcePath
    .replace(/\\/g, "/")
    .normalize("NFC")
    .toLowerCase()

  return createHash("sha256").update(stablePath).digest("hex").slice(0, 32)
}

export async function generateShows(rootDirectory = process.cwd()) {
  const showsDirectory = path.join(rootDirectory, "files")

  const hlsOutputDirectory = path.join(
    rootDirectory,
    "video-processing",
    "output",
  )

  const outputPath = path.join(rootDirectory, "public", "data", "shows.json")

  const hlsIndexPath = path.join(
    rootDirectory,
    "video-processing",
    "metadata",
    "media-output-index.json",
  )

  let hlsIndex = {}

  try {
    hlsIndex = JSON.parse(fs.readFileSync(hlsIndexPath, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }

  if (!fs.existsSync(showsDirectory)) {
    throw new Error(`Pasta de desenhos não encontrada: ${showsDirectory}`)
  }

  const previousShows = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
    : []

  const previousByTitle = new Map(
    previousShows.map((show) => [show.title, show]),
  )

  const showIdCounts = new Map()

  const episodeIdCounts = new Map()

  for (const show of previousShows) {
    showIdCounts.set(show.id, (showIdCounts.get(show.id) ?? 0) + 1)

    for (const episode of show.episodes) {
      episodeIdCounts.set(
        episode.id,
        (episodeIdCounts.get(episode.id) ?? 0) + 1,
      )
    }
  }

  const usedShowIds = new Set(
    previousShows

      .filter((show) => showIdCounts.get(show.id) === 1)

      .map((show) => show.id),
  )

  const usedEpisodeIds = new Set(
    previousShows

      .flatMap((show) => show.episodes)

      .filter((episode) => episodeIdCounts.get(episode.id) === 1)

      .map((episode) => episode.id),
  )

  let nextShowId = Math.max(0, ...usedShowIds) + 1

  let nextEpisodeId = Math.max(0, ...usedEpisodeIds) + 1

  const directories = fs

    .readdirSync(showsDirectory, { withFileTypes: true })

    .filter((entry) => entry.isDirectory())

    .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"))

  const shows = []

  for (const [index, directory] of directories.entries()) {
    const showTitle = directory.name

    const showPath = path.join(showsDirectory, showTitle)

    const files = fs
      .readdirSync(showPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())

    const images = files.filter((entry) =>
      imageExtensions.has(path.extname(entry.name).toLowerCase()),
    )

    const videos = files.filter(
      (entry) => path.extname(entry.name).toLowerCase() === ".mp4",
    )

    const imageByBaseName = new Map(
      images.map((entry) => [
        titleFromFilename(entry.name).toLowerCase(),
        entry.name,
      ]),
    )

    const coverFile =
      imageByBaseName.get("capa") ??
      (images.length === 1 ? images[0].name : undefined)

    const defaultEpisodeImageFile = imageByBaseName.get("take")

    if (!coverFile) {
      console.warn(
        `[KidsPlay] ${showTitle}: capa não encontrada (esperado capa.png/jpg/jpeg). Desenho ignorado.`,
      )

      continue
    }

    if (videos.length === 0) {
      console.warn(
        `[KidsPlay] ${showTitle}: nenhum episódio MP4 encontrado. Exibido como "em breve".`,
      )
    }

    const previousShow = previousByTitle.get(showTitle)

    const previousEpisodes = new Map(
      (previousShow?.episodes ?? []).map((episode) => [episode.file, episode]),
    )

    const episodes = await Promise.all(
      videos

        .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"))

        .map(async (file) => {
          const previousEpisode = previousEpisodes.get(file.name)

          const episodeId =
            previousEpisode && episodeIdCounts.get(previousEpisode.id) === 1
              ? previousEpisode.id
              : nextEpisodeId++

          usedEpisodeIds.add(episodeId)

          const episodeTitle = titleFromFilename(file.name)

          const relativeSourcePath = path
            .relative(showsDirectory, path.join(showPath, file.name))
            .split(path.sep)
            .join("/")

          const indexedHls = hlsIndex[stableEpisodeKey(relativeSourcePath)]

          const indexedHlsPath =
            typeof indexedHls === "string"
              ? path.resolve(rootDirectory, indexedHls)
              : undefined

          const hls = await findHlsMasterUrl(
            showTitle,
            episodeTitle,
            hlsOutputDirectory,
            indexedHlsPath,
          )

          const thumbnailName = `${stableEpisodeKey(relativeSourcePath)}.jpg`

          const generatedThumbnail = path.join(
            rootDirectory,
            "video-processing",
            "thumbnails",
            "episodes",
            thumbnailName,
          )

          // Priority: "<episode>.jpg" next to the MP4 → show-wide "take.jpg" → show cover.

          const episodeImageFile =
            imageByBaseName.get(episodeTitle.toLowerCase()) ??
            defaultEpisodeImageFile ??
            coverFile

          return {
            id: episodeId,

            title: episodeTitle,

            file: file.name,

            ...(hls ? { hls } : {}),

            image: fs.existsSync(generatedThumbnail)
              ? urlPath("thumbnails", "episodes", thumbnailName)
              : urlPath("files", showTitle, episodeImageFile),
          }
        }),
    )

    const showId =
      previousShow && showIdCounts.get(previousShow.id) === 1
        ? previousShow.id
        : nextShowId++

    usedShowIds.add(showId)

    shows.push({
      id: showId,

      title: showTitle,

      color: previousShow?.color ?? colors[index % colors.length],

      image: urlPath("files", showTitle, coverFile),

      episodes,
    })
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })

  fs.writeFileSync(outputPath, `${JSON.stringify(shows, null, 2)}\n`)

  console.log(
    `[KidsPlay] Catálogo validado: ${shows.length} desenho(s), ${shows.reduce((total, show) => total + show.episodes.length, 0)} episódio(s).`,
  )

  return shows
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await generateShows()
}
