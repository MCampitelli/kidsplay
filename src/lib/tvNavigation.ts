// Spatial focus navigation for TV remotes (arrow keys).

export const TV_FOCUSABLE_SELECTOR =
  "button:not([disabled]), input:not([disabled]), [data-tv-focusable]"

export function getNextTvTarget(
  current: HTMLElement,
  direction: "left" | "right" | "up" | "down",
) {
  const currentRect = current.getBoundingClientRect()
  const currentCenterX = currentRect.left + currentRect.width / 2
  const currentCenterY = currentRect.top + currentRect.height / 2
  const currentRow = current.closest<HTMLElement>("[data-tv-row]")
  if (currentRow) {
    if (direction === "left" || direction === "right") {
      const cards = Array.from(currentRow.querySelectorAll<HTMLElement>(".tv-poster-card"))
      return cards[cards.indexOf(current) + (direction === "left" ? -1 : 1)]
    }
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-tv-row]"))
    const nextRow = rows[rows.indexOf(currentRow) + (direction === "up" ? -1 : 1)]
    if (nextRow) {
      const rowRect = nextRow.getBoundingClientRect()
      return Array.from(nextRow.querySelectorAll<HTMLElement>(".tv-poster-card"))
        .filter((card) => {
          const rect = card.getBoundingClientRect()
          return rect.right > rowRect.left && rect.left < rowRect.right
        })
        .sort((first, second) => {
          const a = first.getBoundingClientRect()
          const b = second.getBoundingClientRect()
          return Math.abs(a.left + a.width / 2 - currentCenterX) - Math.abs(b.left + b.width / 2 - currentCenterX)
        })[0]
    }
    if (direction === "down") return undefined
  }

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(TV_FOCUSABLE_SELECTOR),
  ).filter(
    (candidate) =>
      candidate !== current && candidate.getClientRects().length > 0,
  )

  const directionalCandidates = candidates
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect()
      const deltaX = rect.left + rect.width / 2 - currentCenterX
      const deltaY = rect.top + rect.height / 2 - currentCenterY
      const isInDirection =
        (direction === "left" && deltaX < -4) ||
        (direction === "right" && deltaX > 4) ||
        (direction === "up" && deltaY < -4) ||
        (direction === "down" && deltaY > 4)

      if (!isInDirection) return null

      const primaryDistance =
        direction === "left" || direction === "right"
          ? Math.abs(deltaX)
          : Math.abs(deltaY)
      const crossAxisDistance =
        direction === "left" || direction === "right"
          ? Math.abs(deltaY)
          : Math.abs(deltaX)
      return { candidate, score: primaryDistance + crossAxisDistance * 2 }
    })
    .filter(
      (candidate): candidate is { candidate: HTMLElement; score: number } =>
        candidate !== null,
    )

  return directionalCandidates.sort(
    (first, second) => first.score - second.score,
  )[0]?.candidate
}

export function focusAndReveal(element: HTMLElement | null | undefined) {
  if (!element) return
  element.focus({ preventScroll: true })
  element.scrollIntoView({ block: "nearest", inline: "nearest" })
}
