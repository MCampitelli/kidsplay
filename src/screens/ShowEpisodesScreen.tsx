import { useEffect, useRef } from "react"
import type { Episode, Show } from "../types/catalog"
import { EpisodeCard } from "../components/EpisodeCard"
import { focusAndReveal } from "../lib/tvNavigation"

export function ShowEpisodesScreen({
  show,
  initialFocusEpisodeId,
  onBack,
  onEpisodeSelect,
  isFavorite,
  onToggleFavorite,
}: {
  show: Show
  initialFocusEpisodeId: number | null
  onBack: () => void
  onEpisodeSelect: (episode: Episode) => void
  isFavorite: boolean
  onToggleFavorite: () => void
}) {
  const episodeRefs = useRef(new Map<number, HTMLButtonElement>())
  const backButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
    const firstEpisode = show.episodes[0]
    const target =
      (initialFocusEpisodeId !== null &&
        episodeRefs.current.get(initialFocusEpisodeId)) ||
      (firstEpisode && episodeRefs.current.get(firstEpisode.id)) ||
      backButtonRef.current
    focusAndReveal(target)
  }, [show.id])

  useEffect(() => {
    if (show.episodes.some((episode) => episode.hls)) void import("hls.js")
  }, [show.id])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.key === "GoBack"
      ) {
        event.preventDefault()
        onBack()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onBack])

  return (
    <main className="px-8 sm:px-14 pt-2 pb-16">
      <button
        ref={backButtonRef}
        type="button"
        onClick={onBack}
        className="tv-pill"
        data-tv-focusable
      >
        ← Voltar
      </button>
      <section className="mt-6 flex items-end gap-6 sm:gap-10">
        {show.image && (
          <img
            src={show.image}
            alt={show.title}
            draggable={false}
            className="tv-detail-poster"
            style={{ borderColor: show.color }}
          />
        )}
        <div className="min-w-0">
          <h1 className="font-display text-4xl sm:text-6xl text-white drop-shadow-lg">
            {show.title}
          </h1>
          <p className="mt-2 text-lg font-bold text-white/80">
            {show.episodes.length === 0
              ? "Em breve"
              : `${show.episodes.length} ${
                  show.episodes.length === 1 ? "episódio" : "episódios"
                }`}
          </p>
          {show.description && (
            <p className="mt-3 max-w-prose whitespace-pre-line text-base leading-relaxed text-white/85">
              {show.description}
            </p>
          )}
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={isFavorite}
            aria-label={
              isFavorite
                ? `Remover ${show.title} dos favoritos`
                : `Favoritar ${show.title}`
            }
            className={`favorite-button mt-5 ${
              isFavorite ? "favorite-button-active" : ""
            }`}
            data-tv-focusable
            data-scroll-to-top-on-focus
            data-scroll-to-episodes-on-down
          >
            {isFavorite ? "★ Favoritado" : "☆ Favoritar"}
          </button>
        </div>
      </section>
      <h2
        className="mt-10 font-display text-3xl text-white drop-shadow"
        data-tv-episodes-start
      >
        Episódios
      </h2>
      {show.episodes.length === 0 && (
        <p className="mt-6 inline-block rounded-2xl bg-black/45 px-6 py-4 text-xl font-bold text-white">
          Os episódios deste desenho chegam em breve!
        </p>
      )}
      <div className="tv-episode-grid" data-tv-episode-grid>
        {show.episodes.map((episode, index) => (
          <EpisodeCard
            key={episode.id}
            episode={episode}
            number={index + 1}
            fallbackImage={show.image}
            showColor={show.color}
            onSelect={() => onEpisodeSelect(episode)}
            buttonRef={(element) => {
              if (element) episodeRefs.current.set(episode.id, element)
              else episodeRefs.current.delete(episode.id)
            }}
          />
        ))}
      </div>
    </main>
  )
}
