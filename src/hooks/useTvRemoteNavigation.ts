import { useEffect } from "react"
import { getNextTvTarget } from "../lib/tvNavigation"

/** Arrow-key navigation between focusable elements outside the player. */
export function useTvRemoteNavigation(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    function handleRemoteNavigation(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return

      const directions = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      } as const
      const direction = directions[(event.key as keyof typeof directions)]
      if (!direction) return

      const activeElement = document.activeElement
      if (!(activeElement instanceof HTMLElement)) return

      const episodeGrid = activeElement.closest<HTMLElement>(
        "[data-tv-episode-grid]",
      )
      const firstEpisode = episodeGrid?.querySelector<HTMLElement>(
        ".tv-episode-card",
      )
      const isFirstEpisodeRow =
        activeElement.matches(".tv-episode-card") &&
        firstEpisode !== null &&
        firstEpisode !== undefined &&
        activeElement.offsetTop === firstEpisode.offsetTop
      const nextTarget =
        direction === "up" && isFirstEpisodeRow
          ? document.querySelector<HTMLElement>("[data-scroll-to-top-on-focus]")
          : getNextTvTarget(activeElement, direction)
      if (!nextTarget) return

      event.preventDefault()
      nextTarget.focus({ preventScroll: true })
      if (nextTarget.hasAttribute("data-scroll-to-top-on-focus")) {
        window.scrollTo({ top: 0, behavior: "smooth" })
      } else if (
        direction === "down" &&
        activeElement.hasAttribute("data-scroll-to-episodes-on-down")
      ) {
        const episodesStart = document.querySelector<HTMLElement>(
          "[data-tv-episodes-start]",
        )
        episodesStart?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      } else {
        nextTarget.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        })
      }
    }

    window.addEventListener("keydown", handleRemoteNavigation)
    return () => window.removeEventListener("keydown", handleRemoteNavigation)
  }, [enabled])
}
