import { useCallback, useEffect, useState } from "react"
import type { AuthenticatedAccount } from "../../services/authService"
import { ApiError, familyApi, type ProfileSummary } from "../api"
import { Avatar, LoadingBlock, Notice, NowWatchingBadge, ScreenTimeBar, TopBar } from "../components"
import type { ViewProps } from "../ParentsApp"
import { useInstallPrompt } from "../useInstallPrompt"

// Atualiza o "assistindo agora" e o tempo de tela enquanto a tela esta aberta.
const REFRESH_MS = 15_000

export function HomeView({
  account,
  navigate,
  onUnauthorized,
  onLogout,
}: ViewProps & { account: AuthenticatedAccount; onLogout: () => Promise<void> }) {
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [error, setError] = useState("")
  const install = useInstallPrompt()
  const [showIosSteps, setShowIosSteps] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await familyApi.overview()
      setProfiles(data.profiles)
      setError("")
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return onUnauthorized()
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar.")
    }
  }, [onUnauthorized])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    const onVisible = () => document.visibilityState === "visible" && void load()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  const firstName = account.name.split(" ")[0]

  return (
    <div className="min-h-dvh">
      <TopBar
        title="Área dos Pais"
        right={
          <button type="button" onClick={() => void onLogout()} className="rounded-full px-3 py-2 text-sm font-extrabold text-white/85 hover:bg-white/10">
            Sair
          </button>
        }
      />
      <main className="safe-bottom mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-5">
        <section>
          <p className="font-display text-2xl">Olá, {firstName}!</p>
          <p className="font-semibold text-muted">Escolha uma criança para ver e ajustar o que ela assiste.</p>
        </section>

        {error && <Notice>{error}</Notice>}
        {!profiles && !error && <LoadingBlock />}

        {profiles?.length === 0 && (
          <div className="card p-6 text-center">
            <p className="font-display text-xl">Nenhum perfil ainda</p>
            <p className="mt-1 font-semibold text-muted">Crie um perfil para cada criança. Ele aparece na TV em "Quem vai assistir?".</p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {profiles?.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                onClick={() => navigate({ name: "profile", id: profile.id })}
                className="card flex w-full items-center gap-4 p-4 text-left transition-transform active:scale-[0.99]"
              >
                <Avatar avatar={profile.avatar} name={profile.name} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-lg font-extrabold">{profile.name}</span>
                    {profile.blockedCount > 0 && (
                      <span className="shrink-0 rounded-full bg-[#ffe8e8] px-2.5 py-0.5 text-xs font-extrabold text-[#c93a3a]">
                        {profile.blockedCount} bloqueado{profile.blockedCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                  <NowWatchingBadge nowWatching={profile.nowWatching} />
                  <ScreenTimeBar screenTime={profile.screenTime} compact />
                </span>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </li>
          ))}
        </ul>

        {profiles && (
          <button type="button" onClick={() => navigate({ name: "new-profile" })} className="btn btn-ghost w-full border-2 border-dashed border-[#cfc4f5]">
            <span aria-hidden="true" className="text-xl leading-none">+</span> Adicionar perfil
          </button>
        )}

        <button type="button" onClick={() => navigate({ name: "suggestions" })} className="card flex items-center gap-4 p-4 text-left">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sun text-brand" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
            </svg>
          </span>
          <span className="flex-1">
            <span className="block font-extrabold">Sugerir um desenho</span>
            <span className="block text-sm font-semibold text-muted">Peça um desenho novo e acompanhe a resposta.</span>
          </span>
        </button>

        {(install.canPrompt || install.showIosHelp) && (
          <div className="card flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <img src="/pais/icon-192.png" alt="" className="h-12 w-12 rounded-2xl" />
              <div>
                <p className="font-extrabold">Salvar na tela inicial</p>
                <p className="text-sm font-semibold text-muted">Abra a Área dos Pais como um app, com um toque.</p>
              </div>
            </div>
            {install.canPrompt ? (
              <button type="button" onClick={() => void install.install()} className="btn btn-sun w-full">
                Instalar
              </button>
            ) : (
              <>
                <button type="button" onClick={() => setShowIosSteps((open) => !open)} className="btn btn-ghost w-full">
                  Como instalar no iPhone
                </button>
                {showIosSteps && (
                  <ol className="list-decimal space-y-1 pl-6 text-sm font-semibold text-muted">
                    <li>Toque em <strong className="text-ink">Compartilhar</strong> (quadrado com seta) no Safari.</li>
                    <li>Escolha <strong className="text-ink">Adicionar à Tela de Início</strong>.</li>
                    <li>Toque em <strong className="text-ink">Adicionar</strong>.</li>
                  </ol>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
