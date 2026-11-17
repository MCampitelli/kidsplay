import { useEffect, useState } from "react"
import type { Profile } from "../types/profile"

/** Per-profile favorite titles, persisted in localStorage. */
export function useFavoriteShows(currentUser: Profile | null) {
  const [favoriteShowIds, setFavoriteShowIds] = useState<number[]>([])

  useEffect(() => {
    if (!currentUser) {
      setFavoriteShowIds([])
      return
    }
    try {
      const storedFavorites = localStorage.getItem(
        `kidsplay-favorite-shows-${currentUser.id}`,
      )
      setFavoriteShowIds(storedFavorites ? JSON.parse(storedFavorites) : [])
    } catch {
      setFavoriteShowIds([])
    }
  }, [currentUser])

  function toggleFavorite(showId: number) {
    if (!currentUser) return
    setFavoriteShowIds((currentFavorites) => {
      const nextFavorites = currentFavorites.includes(showId)
        ? currentFavorites.filter((id) => id !== showId)
        : [...currentFavorites, showId]
      localStorage.setItem(
        `kidsplay-favorite-shows-${currentUser.id}`,
        JSON.stringify(nextFavorites),
      )
      return nextFavorites
    })
  }

  return { favoriteShowIds, toggleFavorite }
}
