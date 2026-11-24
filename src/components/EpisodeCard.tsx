import type { Episode } from "../types/catalog"

// Static artwork only: episode videos are loaded exclusively by PlayerScreen.
export function EpisodeCard({
  episode,
  number,
  fallbackImage,
  showColor,
  onSelect,
  buttonRef,
}: {
  episode: Episode
  number: number
  fallbackImage?: string
  showColor: string
  onSelect: () => void
  buttonRef: (element: HTMLButtonElement | null) => void
}) {
  const image = episode.image ?? fallbackImage
  const hasVideo = Boolean(episode.file || episode.hls)
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={!hasVideo}
      className="tv-episode-card"
      data-tv-focusable
      aria-label={hasVideo ? `Assistir episódio ${number}: ${episode.title}` : `Episódio ${number}: ${episode.title}, mídia indisponível`}
      onClick={onSelect}
    >
      <span className="tv-episode-frame">
        {image && (
          <img
            src={image}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-black/10" />
        <span
          className="absolute left-4 top-3 font-display text-4xl drop-shadow-lg"
          style={{ color: showColor }}
        >
          {number}
        </span>
        <span className="absolute inset-x-4 bottom-3 text-left text-lg font-extrabold leading-tight text-white line-clamp-2 drop-shadow-md">
          {episode.title}
        </span>
      </span>
    </button>
  )
}
