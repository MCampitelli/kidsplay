import { useEffect, useState } from "react"
import type { Profile } from "./types/profile"
import type { Episode, Show } from "./types/catalog"
import { profileService } from "./services/profileService"
import { getSession, login, logout } from "./services/authService"
import { apiFetch } from "./services/apiClient"
import { AdminPanel } from "./components/AdminPanel"
import { Navbar } from "./components/Navbar"
import { CredentialsScreen } from "./screens/CredentialsScreen"
import { ProfileScreen } from "./screens/ProfileScreen"
import { PlayerScreen } from "./screens/PlayerScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { ShowEpisodesScreen } from "./screens/ShowEpisodesScreen"
import { useFavoriteShows } from "./hooks/useFavoriteShows"
import { useTvRemoteNavigation } from "./hooks/useTvRemoteNavigation"

function getEpisodeVideoSrc(show: Show, episode: Episode) {
  if (!episode.file) return ""
  if (episode.file.startsWith("/") || /^https?:\/\//i.test(episode.file)) return episode.file
  return `/files/${show.title}/${episode.file}`
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [currentUser, setCurrentUser] = useState<Profile | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [shows, setShows] = useState<Show[]>([])
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading")
  const [selectedShow, setSelectedShow] = useState<Show | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<{
    show: Show
    episode: Episode
  } | null>(null)
  const [lastHomeCard, setLastHomeCard] = useState<string | null>(null)
  const [lastEpisodeId, setLastEpisodeId] = useState<number | null>(null)

  const { favoriteShowIds, toggleFavorite } = useFavoriteShows(currentUser)
  useTvRemoteNavigation(Boolean(currentUser) && !selectedEpisode)

  function handleLogout() {
    void logout().then(() => {
      setIsAuthenticated(false)
      setShowAdminPanel(false)
      setCurrentUser(null)
      setSelectedShow(null)
      setSelectedEpisode(null)
    }).catch((error: unknown) => {
      console.error("[KidsPlay] Falha ao encerrar a sessão.")
      window.alert(error instanceof Error ? error.message : "Não foi possível sair. Tente novamente.")
    })
  }

  useEffect(() => {
    let cancelled = false
    let previousCatalog = ""

    async function loadCatalog() {
      try {
        const showsRes = await apiFetch("/api/catalog", { cache: "no-store" })
        if (!showsRes.ok) throw new Error(`Falha HTTP ${showsRes.status}`)
        const catalogText = await showsRes.text()
        if (cancelled) return
        if (catalogText === previousCatalog) {
          setCatalogStatus("ready")
          return
        }
        const catalog: Show[] = JSON.parse(catalogText)
        previousCatalog = catalogText
        setShows(catalog)
        setCatalogStatus("ready")
      } catch (error) {
        if (!cancelled) setCatalogStatus("error")
        console.error("Error loading catalog:", error)
      }
    }

    async function restoreSession() {
      try {
        const account = await getSession()
        if (!account || cancelled) return
        const profilesData = await profileService.getProfiles()
        if (cancelled) return
        setProfiles(profilesData)
        setIsAuthenticated(true)
        setShowAdminPanel(true)
      } catch (error) {
        console.error("Error restoring session:", error)
      }
    }

    void loadCatalog()
    void restoreSession()
    // 60s keeps a small production server comfortable with many TVs open;
    // returning to the tab/app also refreshes immediately.
    const catalogRefreshTimer = window.setInterval(() => void loadCatalog(), 60_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadCatalog()
    }
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      cancelled = true
      clearInterval(catalogRefreshTimer)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [])

  if (!isAuthenticated) {
    return (
      <CredentialsScreen
        onLogin={async (email, password) => {
          await login(email, password)
          const profilesData = await profileService.getProfiles()
          setProfiles(profilesData)
          setIsAuthenticated(true)
          setShowAdminPanel(true)
        }}
      />
    )
  }

  if (showAdminPanel) {
    return (
      <AdminPanel
        profiles={profiles}
        onProfilesChange={setProfiles}
        onEnterProfile={(profile) => {
          setCurrentUser(profile)
          setShowAdminPanel(false)
        }}
        onLogout={handleLogout}
      />
    )
  }

  if (!currentUser) {
    return (
      <ProfileScreen
        profiles={profiles}
        onLogin={setCurrentUser}
        onManageProfiles={() => setShowAdminPanel(true)}
      />
    )
  }

  if (selectedEpisode) {
    return (
      <PlayerScreen
        show={selectedEpisode.show}
        episode={selectedEpisode.episode}
        videoSrc={getEpisodeVideoSrc(
          selectedEpisode.show,
          selectedEpisode.episode,
        )}
        hlsSrc={selectedEpisode.episode.hls}
        onBack={() => {
          setLastEpisodeId(selectedEpisode.episode.id)
          setSelectedEpisode(null)
        }}
        onEpisodeChange={(episode) =>
          setSelectedEpisode({ show: selectedEpisode.show, episode })
        }
        currentUser={currentUser}
      />
    )
  }

  return (
    <div className="relative min-h-screen text-white">
      <div className="app-backdrop" aria-hidden="true" />
      <div className="relative z-10">
        <Navbar
          currentUser={currentUser}
          onLogout={handleLogout}
          onSwitchProfile={() => {
            setCurrentUser(null)
            setSelectedShow(null)
            setSelectedEpisode(null)
          }}
        />
        {selectedShow ? (
          <ShowEpisodesScreen
            show={selectedShow}
            initialFocusEpisodeId={lastEpisodeId}
            onBack={() => setSelectedShow(null)}
            onEpisodeSelect={(episode) =>
              setSelectedEpisode({ show: selectedShow, episode })
            }
            isFavorite={favoriteShowIds.includes(selectedShow.id)}
            onToggleFavorite={() => toggleFavorite(selectedShow.id)}
          />
        ) : (
          <HomeScreen
            shows={shows}
            catalogStatus={catalogStatus}
            initialFocusCard={lastHomeCard}
            onOpenShow={(show, cardKey) => {
              setLastHomeCard(cardKey)
              setLastEpisodeId(null)
              setSelectedShow(show)
            }}
          />
        )}
      </div>
    </div>
  )
}
