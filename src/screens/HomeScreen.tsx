import { useEffect, useMemo, useRef } from "react"
import type { Show } from "../types/catalog"
import { focusAndReveal } from "../lib/tvNavigation"

export function HomeScreen({
  shows,
  catalogStatus,
  initialFocusCard,
  onOpenShow,
}: {
  shows: Show[]
  catalogStatus: "loading" | "ready" | "error"
  initialFocusCard: string | null
  onOpenShow: (show: Show, cardKey: string) => void
}) {
  const cardRefs = useRef(new Map<string, HTMLButtonElement>())
  const didFocus = useRef(false)
  const rows = useMemo(() => {
    const categories = new Map<
      number,
      { id: number; name: string; displayOrder: number; shows: Show[] }
    >()
    for (const show of shows) {
      for (const tag of show.tags) {
        let category = categories.get(tag.id)
        if (!category) {
          category = { id: tag.id, name: tag.name, displayOrder: tag.displayOrder, shows: [] }
          categories.set(tag.id, category)
        }
        category.shows.push(show)
      }
    }
    return [
      ...[...categories.values()].sort(
        (a, b) =>
          a.displayOrder - b.displayOrder ||
          a.name.localeCompare(b.name, "pt-BR") ||
          a.id - b.id,
      ).map((category) => ({ ...category, id: `tag-${category.id}` })),
      { id: "all", name: "Desenhos", displayOrder: 0, shows },
    ].filter((row) => row.shows.length > 0)
  }, [shows])

  useEffect(() => {
    if (shows.length === 0) return
    if (didFocus.current && document.activeElement !== document.body) return
    const target =
      (initialFocusCard !== null && cardRefs.current.get(initialFocusCard)) ||
      cardRefs.current.values().next().value
    focusAndReveal(target)
    didFocus.current = true
  }, [shows, initialFocusCard])

  return (
    <main className="px-8 sm:px-14 pt-4 pb-16">
      <h1 className="sr-only">Desenhos</h1>
      {catalogStatus === "error" && shows.length > 0 && (
        <p role="status" className="mb-4 font-bold text-[#FFD93D]">
          Não foi possível atualizar o catálogo. Exibindo a última versão carregada.
        </p>
      )}
      {shows.length === 0 ? (
        <p className="mt-8 text-xl font-bold text-white/80">
          {catalogStatus === "loading"
            ? "Carregando..."
            : catalogStatus === "error"
              ? "Não foi possível carregar o catálogo."
              : "Nenhum título publicado."}
        </p>
      ) : (
        rows.map((row) => (
          <section key={row.id} aria-labelledby={`heading-${row.id}`} className="mb-6">
            <h2
              id={`heading-${row.id}`}
              className="font-display text-4xl sm:text-5xl text-white drop-shadow-lg"
            >
              {row.name}
            </h2>
            <div className="tv-row" data-tv-row={row.id}>
              {row.shows.map((show) => (
                <button
                  key={show.id}
                  ref={(element) => {
                    const key = `${row.id}:${show.id}`
                    if (element) cardRefs.current.set(key, element)
                    else cardRefs.current.delete(key)
                  }}
                  type="button"
                  className="tv-poster-card"
                  data-tv-focusable
                  aria-label={`Abrir ${show.title}`}
                  onClick={() => onOpenShow(show, `${row.id}:${show.id}`)}
                >
                  <span className="tv-poster-frame">
                    {show.image && (
                      <img
                        src={show.image}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        decoding="async"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="tv-poster-title">{show.title}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  )
}
