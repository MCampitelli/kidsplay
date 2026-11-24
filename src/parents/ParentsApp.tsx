import { useCallback, useEffect, useState } from "react"
import { getSession, login, logout, type AuthenticatedAccount } from "../services/authService"
import { LoadingBlock } from "./components"
import { LoginView } from "./views/LoginView"
import { HomeView } from "./views/HomeView"
import { ProfileView } from "./views/ProfileView"
import { ProfileFormView } from "./views/ProfileFormView"
import { SuggestionsView } from "./views/SuggestionsView"

export type Route =
  | { name: "home" }
  | { name: "profile"; id: number }
  | { name: "edit-profile"; id: number }
  | { name: "new-profile" }
  | { name: "suggestions" }

// Rotas no fragmento (#/perfil/3): o botao "voltar" do celular navega dentro do app.
function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "")
  const profile = path.match(/^perfil\/(\d+)$/)
  if (profile) return { name: "profile", id: Number(profile[1]) }
  const edit = path.match(/^perfil\/(\d+)\/editar$/)
  if (edit) return { name: "edit-profile", id: Number(edit[1]) }
  if (path === "novo-perfil") return { name: "new-profile" }
  if (path === "sugestoes") return { name: "suggestions" }
  return { name: "home" }
}

export function routeHash(route: Route) {
  switch (route.name) {
    case "profile":
      return `#/perfil/${route.id}`
    case "edit-profile":
      return `#/perfil/${route.id}/editar`
    case "new-profile":
      return "#/novo-perfil"
    case "suggestions":
      return "#/sugestoes"
    default:
      return "#/"
  }
}

export function ParentsApp() {
  const [account, setAccount] = useState<AuthenticatedAccount | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    // "Voltar" do celular/navegador: reflete a rota da entrada do historico.
    const onPopState = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  useEffect(() => {
    getSession()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setCheckingSession(false))
  }, [])

  // Cada navegacao interna guarda a profundidade no historico; assim "voltar" so usa
  // history.back() quando a entrada anterior e do proprio app.
  const navigate = useCallback((next: Route) => {
    const depth = Number((window.history.state as { depth?: number } | null)?.depth ?? 0)
    window.history.pushState({ depth: depth + 1 }, "", routeHash(next))
    setRoute(next)
    window.scrollTo(0, 0)
  }, [])

  const goBack = useCallback((fallback: Route) => {
    const depth = Number((window.history.state as { depth?: number } | null)?.depth ?? 0)
    if (depth > 0) {
      window.history.back()
      return
    }
    window.history.replaceState({ depth: 0 }, "", routeHash(fallback))
    setRoute(fallback)
    window.scrollTo(0, 0)
  }, [])

  const handleUnauthorized = useCallback(() => setAccount(null), [])

  if (checkingSession) return <LoadingBlock />

  if (!account) {
    return (
      <LoginView
        onLogin={async (email, password) => {
          const user = await login(email, password)
          setAccount(user)
          navigate({ name: "home" })
        }}
      />
    )
  }

  const common = { navigate, goBack, onUnauthorized: handleUnauthorized }

  switch (route.name) {
    case "profile":
      return <ProfileView key={route.id} profileId={route.id} {...common} />
    case "edit-profile":
      return <ProfileFormView key={`edit-${route.id}`} profileId={route.id} {...common} />
    case "new-profile":
      return <ProfileFormView key="new" profileId={null} {...common} />
    case "suggestions":
      return <SuggestionsView {...common} />
    default:
      return (
        <HomeView
          account={account}
          {...common}
          onLogout={async () => {
            await logout().catch(() => undefined)
            setAccount(null)
          }}
        />
      )
  }
}

export type ViewProps = {
  navigate: (route: Route) => void
  goBack: (fallback: Route) => void
  onUnauthorized: () => void
}
