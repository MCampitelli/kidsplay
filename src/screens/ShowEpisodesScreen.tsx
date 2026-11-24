import { useEffect, useRef } from "react"
import type { Episode, Show } from "../types/catalog"
import { EpisodeCard } from "../components/EpisodeCard"
import { BackIcon, PlayIcon, StarIcon } from "../components/PlayerIcons"
import { focusAndReveal } from "../lib/tvNavigation"

// Tela do titulo: topo com a arte do desenho em tela cheia, nome, descricao e acoes;
// abaixo, a lista de episodios, com a arte se dissolvendo no fundo padrao do app.
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
  const watchButtonRef = useRef<HTMLButtonElement>(null)
  const favoriteButtonRef = useRef<HTMLButtonElement>(null)

  const firstPlayableEpisode = show.episodes.find((episode) => episode.file || episode.hls)
  const heroImage = show.banner || show.image
  const episodeCount = show.episodes.length

  useEffect(() => {
    // Voltando do player, o foco fica no episodio assistido (ja na lista).
    // Abrindo o desenho, a tela comeca no topo, nas informacoes do titulo.
    const returningEpisode =
      initialFocusEpisodeId !== null ? episodeRefs.current.get(initialFocusEpisodeId) : undefined
    if (returningEpisode) {
      focusAndReveal(returningEpisode)
      return
    }
    window.scrollTo(0, 0)
    ;(watchButtonRef.current ?? favoriteButtonRef.current)?.focus({ preventScroll: true })
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
    <main className="relative -mt-20 pb-16">
      {heroImage && (
        <div className="show-hero-art" aria-hidden="true">
          <img src={heroImage} alt="" draggable={false} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/60 to-transparent" />
        </div>
      )}

      <section className="show-hero relative z-10 flex flex-col px-8 pt-24 sm:px-14">
        <button
          type="button"
          onClick={onBack}
          className="tv-pill self-start gap-2"
          aria-label="Voltar ao catálogo"
          data-tv-focusable
        >
          <BackIcon className="h-5 w-5" />
          Voltar
        </button>

        <div className="mt-auto max-w-3xl pb-10 sm:pb-14">
          <h1 className="font-display text-5xl leading-none text-white drop-shadow-lg sm:text-7xl">
            {show.title}
          </h1>
          <p className="mt-4 text-sm font-extrabold uppercase tracking-wider text-[#FFD93D] sm:text-base">
            {episodeCount === 0
              ? "Em breve"
              : `${episodeCount} ${episodeCount === 1 ? "episódio" : "episódios"}`}
          </p>
          {show.description && (
            <p className="mt-3 line-clamp-4 max-w-2xl whitespace-pre-line text-base leading-relaxed text-white/90 drop-shadow sm:text-lg">
              {show.description}
            </p>
          )}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {firstPlayableEpisode && (
              <button
                ref={watchButtonRef}
                type="button"
                onClick={() => onEpisodeSelect(firstPlayableEpisode)}
                className="show-hero-watch"
                data-tv-focusable
                data-scroll-to-top-on-focus
                data-scroll-to-episodes-on-down
              >
                <PlayIcon className="h-5 w-5" />
                Assistir
              </button>
            )}
            <button
              ref={favoriteButtonRef}
              type="button"
              onClick={onToggleFavorite}
              aria-pressed={isFavorite}
              aria-label={
                isFavorite
                  ? `Remover ${show.title} dos favoritos`
                  : `Favoritar ${show.title}`
              }
              className={`favorite-button gap-2 ${isFavorite ? "favorite-button-active" : ""}`}
              data-tv-focusable
              data-scroll-to-top-on-focus
              data-scroll-to-episodes-on-down
            >
              <StarIcon filled={isFavorite} className="h-5 w-5" />
              {isFavorite ? "Favoritado" : "Favoritar"}
            </button>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-8 sm:px-14">
        <h2
          className="font-display text-3xl text-white drop-shadow"
          data-tv-episodes-start
        >
          Episódios
        </h2>
        {episodeCount === 0 && (
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
      </section>
    </main>
  )
}
