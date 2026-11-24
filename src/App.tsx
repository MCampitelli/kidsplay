import { useCallback, useEffect, useState } from "react"
import type { Profile } from "./types/profile"
import type { Episode, Show } from "./types/catalog"
import { profileService } from "./services/profileService"
import { changePassword, getSession, login, logout } from "./services/authService"
import { apiFetch } from "./services/apiClient"
import { getScreenTime } from "./services/playbackService"
import { Navbar } from "./components/Navbar"
import { CredentialsScreen } from "./screens/CredentialsScreen"
import { ChangePasswordScreen } from "./screens/ChangePasswordScreen"
import { ProfileScreen } from "./screens/ProfileScreen"
import { PlayerScreen } from "./screens/PlayerScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { ShowEpisodesScreen } from "./screens/ShowEpisodesScreen"
import { TimeUpScreen } from "./screens/TimeUpScreen"
import { useFavoriteShows } from "./hooks/useFavoriteShows"
import { useTvRemoteNavigation } from "./hooks/useTvRemoteNavigation"

// Cada aparelho lembra o perfil em uso: recarregar o app volta direto para ele.
const ACTIVE_PROFILE_KEY = "kidsplay-active-profile"

function readActiveProfileId(): number | null {
  try {
    const value = Number(localStorage.getItem(ACTIVE_PROFILE_KEY))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeActiveProfileId(id: number | null) {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_PROFILE_KEY)
    else localStorage.setItem(ACTIVE_PROFILE_KEY, String(id))
  } catch {
    // armazenamento indisponivel (ex.: navegacao privada): so nao lembra o perfil
  }
}

function getEpisodeVideoSrc(show: Show, episode: Episode) {
  if (!episode.file) return ""
  if (episode.file.startsWith("/") || /^https?:\/\//i.test(episode.file)) return episode.file
  return `/files/${show.title}/${episode.file}`
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
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
  // Limite diario definido na Area dos Pais: ao esgotar, a TV mostra "Hora de descansar".
  const [timeUp, setTimeUp] = useState(false)
  // Primeiro acesso com senha provisoria: precisa criar a propria senha antes de entrar.
  const [passwordChange, setPasswordChange] = useState<{ temporaryPassword: string } | null>(null)

  const { favoriteShowIds, toggleFavorite } = useFavoriteShows(currentUser)
  useTvRemoteNavigation(Boolean(currentUser) && !selectedEpisode && !timeUp)

  const enterProfile = useCallback((profile: Profile | null) => {
    writeActiveProfileId(profile?.id ?? null)
    setCurrentUser(profile)
    setSelectedShow(null)
    setSelectedEpisode(null)
    setTimeUp(false)
    setShows([])
    setCatalogStatus("loading")
  }, [])

  function handleLogout() {
    void logout().then(() => {
      writeActiveProfileId(null)
      setIsAuthenticated(false)
      setCurrentUser(null)
      setSelectedShow(null)
      setSelectedEpisode(null)
      setTimeUp(false)
    }).catch((error: unknown) => {
      console.error("[KidsPlay] Falha ao encerrar a sessão.")
      window.alert(error instanceof Error ? error.message : "Não foi possível sair. Tente novamente.")
    })
  }

  // Depois do login (ou ao restaurar a sessao): volta ao perfil deste aparelho,
  // ou mostra "Quem vai assistir?".
  function routeAfterAuthentication(profilesData: Profile[], { justLoggedIn }: { justLoggedIn: boolean }) {
    setProfiles(profilesData)
    setIsAuthenticated(true)
    const stored = readActiveProfileId()
    const storedProfile = profilesData.find((profile) => profile.id === stored) ?? null
    enterProfile(storedProfile && !justLoggedIn ? storedProfile : null)
  }

  useEffect(() => {
    let cancelled = false
    async function restoreSession() {
      try {
        const account = await getSession()
        if (!account || cancelled) return
        if (account.mustChangePassword) {
          setPasswordChange({ temporaryPassword: "" })
          return
        }
        const profilesData = await profileService.getProfiles()
        if (!cancelled) routeAfterAuthentication(profilesData, { justLoggedIn: false })
      } catch (error) {
        console.error("Error restoring session:", error)
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Catalogo do perfil ativo: o servidor ja omite os desenhos bloqueados pelos pais.
  const profileId = currentUser?.id ?? null
  useEffect(() => {
    if (profileId === null) return
    let cancelled = false
    let previousCatalog = ""

    async function loadCatalog() {
      try {
        const showsRes = await apiFetch(`/api/catalog?profileId=${profileId}`, { cache: "no-store" })
        if (!showsRes.ok) throw new Error(`Falha HTTP ${showsRes.status}`)
        const catalogText = await showsRes.text()
        if (cancelled) return
        if (catalogText !== previousCatalog) {
          const catalog: Show[] = JSON.parse(catalogText)
          previousCatalog = catalogText
          setShows(catalog)
          // Um desenho bloqueado enquanto aberto some da tela.
          setSelectedShow((open) => (open && !catalog.some((show) => show.id === open.id) ? null : open))
        }
        setCatalogStatus("ready")
      } catch (error) {
        if (!cancelled) setCatalogStatus("error")
        console.error("Error loading catalog:", error)
      }
    }

    async function checkScreenTime() {
      try {
        const time = await getScreenTime(profileId as number)
        if (!cancelled) setTimeUp(time.remainingSeconds === 0)
      } catch {
        // sem resposta: nao bloqueia a crianca por falha de rede
      }
    }

    void loadCatalog()
    void checkScreenTime()
    // 60s keeps a small production server comfortable with many TVs open;
    // returning to the tab/app also refreshes immediately.
    const refreshTimer = window.setInterval(() => {
      void loadCatalog()
      void checkScreenTime()
    }, 60_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void loadCatalog()
        void checkScreenTime()
      }
    }
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      cancelled = true
      clearInterval(refreshTimer)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [profileId])

  if (passwordChange) {
    return (
      <ChangePasswordScreen
        temporaryPassword={passwordChange.temporaryPassword}
        onSubmit={async (currentPassword, newPassword) => {
          await changePassword(currentPassword, newPassword)
          const profilesData = await profileService.getProfiles()
          setPasswordChange(null)
          routeAfterAuthentication(profilesData, { justLoggedIn: true })
        }}
        onCancel={() => {
          setPasswordChange(null)
          handleLogout()
        }}
      />
    )
  }

  if (!isAuthenticated) {
    return (
      <CredentialsScreen
        onLogin={async (email, password) => {
          const account = await login(email, password)
          if (account.mustChangePassword) {
            setPasswordChange({ temporaryPassword: password })
            return
          }
          const profilesData = await profileService.getProfiles()
          routeAfterAuthentication(profilesData, { justLoggedIn: true })
        }}
      />
    )
  }

  if (!currentUser) {
    return (
      <ProfileScreen
        profiles={profiles}
        onLogin={(profile) => enterProfile(profile)}
        onLogout={handleLogout}
      />
    )
  }

  if (timeUp) {
    return (
      <TimeUpScreen
        profile={currentUser}
        onSwitchProfile={() => enterProfile(null)}
      />
    )
  }

  if (selectedEpisode) {
    return (
      <PlayerScreen
        profileId={currentUser.id}
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
        onTimeUp={() => {
          setSelectedEpisode(null)
          setTimeUp(true)
        }}
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
          onSwitchProfile={() => enterProfile(null)}
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
