import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, familyApi, type ProfileDetail } from "../api"
import { Avatar, LoadingBlock, Notice, NowWatchingCard, ScreenTimeBar, TopBar } from "../components"
import { dayLabel, formatClock, formatMinutes, formatTime, historyGroup } from "../format"
import type { ViewProps } from "../ParentsApp"

type Tab = "now" | "time" | "titles" | "history"
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "now", label: "Agora" },
  { id: "time", label: "Tempo" },
  { id: "titles", label: "Desenhos" },
  { id: "history", label: "Histórico" },
]
const LIMIT_PRESETS = [30, 45, 60, 90, 120]
const REFRESH_MS = 15_000

export function ProfileView({ profileId, navigate, goBack, onUnauthorized }: ViewProps & { profileId: number }) {
  const [detail, setDetail] = useState<ProfileDetail | null>(null)
  const [tab, setTab] = useState<Tab>("now")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")
  const savingRef = useRef(false)

  const handleError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) return onUnauthorized()
    setError(caught instanceof Error ? caught.message : "Não foi possível carregar.")
  }, [onUnauthorized])

  const load = useCallback(async () => {
    if (savingRef.current) return
    try {
      setDetail(await familyApi.profile(profileId))
      setError("")
    } catch (caught) {
      handleError(caught)
    }
  }, [profileId, handleError])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  async function save(controls: { dailyLimitMinutes?: number | null; blockedTitleIds?: number[] }, message: string) {
    savingRef.current = true
    setError("")
    try {
      setDetail(await familyApi.updateControls(profileId, controls))
      setSaved(message)
      window.setTimeout(() => setSaved((current) => (current === message ? "" : current)), 2500)
    } catch (caught) {
      handleError(caught)
      void load()
    } finally {
      savingRef.current = false
    }
  }

  const back = () => goBack({ name: "home" })

  if (!detail) {
    return (
      <div className="min-h-dvh">
        <TopBar title="Perfil" onBack={back} />
        <main className="mx-auto max-w-2xl px-4 pt-5">{error ? <Notice>{error}</Notice> : <LoadingBlock />}</main>
      </div>
    )
  }

  const blockedIds = detail.titles.filter((title) => title.blocked).map((title) => title.id)

  return (
    <div className="min-h-dvh">
      <TopBar
        title={detail.name}
        onBack={back}
        right={
          <button type="button" onClick={() => navigate({ name: "edit-profile", id: profileId })} className="rounded-full px-3 py-2 text-sm font-extrabold text-white/85 hover:bg-white/10">
            Editar
          </button>
        }
      />

      <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 bg-canvas/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <Avatar avatar={detail.avatar} name={detail.name} />
            <div className="min-w-0 flex-1">
              <ScreenTimeBar screenTime={detail.screenTime} compact />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-4 gap-1 rounded-full bg-brand-soft p-1" role="tablist" aria-label="Seções do perfil">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`min-h-10 rounded-full px-1 text-sm font-extrabold transition-colors ${tab === item.id ? "bg-white text-brand shadow" : "text-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="safe-bottom mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-1" role="tabpanel">
        {error && <Notice>{error}</Notice>}
        {saved && <Notice tone="success">{saved}</Notice>}

        {tab === "now" && (
          <>
            <NowWatchingCard nowWatching={detail.nowWatching} />
            {detail.history[0] && (
              <div className="card p-5">
                <p className="font-extrabold">Último episódio</p>
                <p className="mt-1 font-bold">{detail.history[0].title}</p>
                <p className="text-sm font-semibold text-muted">
                  {detail.history[0].episodeTitle} · {historyGroup(detail.history[0].lastPlayedAt)} às {formatTime(detail.history[0].lastPlayedAt)}
                </p>
              </div>
            )}
          </>
        )}

        {tab === "time" && (
          <ScreenTimeSettings
            detail={detail}
            onChange={(minutes) =>
              void save({ dailyLimitMinutes: minutes }, minutes === null ? "Sem limite diário." : `Limite de ${formatMinutes(minutes * 60)} por dia salvo.`)
            }
          />
        )}

        {tab === "titles" && (
          <div className="card divide-y divide-[#f0ecfa] overflow-hidden">
            <p className="p-4 text-sm font-semibold text-muted">
              Desenhos bloqueados somem da TV no perfil de {detail.name}.
            </p>
            {detail.titles.map((title) => (
              <div key={title.id} className="flex items-center gap-3 p-3">
                {title.image ? (
                  <img src={title.image} alt="" className="h-16 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <span className="h-16 w-12 shrink-0 rounded-xl bg-brand-soft" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-extrabold">{title.title}</span>
                  <span className={`text-sm font-bold ${title.blocked ? "text-coral" : "text-mint"}`}>
                    {title.blocked ? "Bloqueado" : "Liberado"}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={title.blocked}
                  aria-label={`Bloquear ${title.title}`}
                  className="switch"
                  onClick={() => {
                    const next = title.blocked ? blockedIds.filter((id) => id !== title.id) : [...blockedIds, title.id]
                    setDetail({ ...detail, titles: detail.titles.map((item) => (item.id === title.id ? { ...item, blocked: !title.blocked } : item)) })
                    void save({ blockedTitleIds: next }, title.blocked ? `${title.title} liberado.` : `${title.title} bloqueado.`)
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {tab === "history" && <History detail={detail} />}
      </main>
    </div>
  )
}

function ScreenTimeSettings({ detail, onChange }: { detail: ProfileDetail; onChange: (minutes: number | null) => void }) {
  const limit = detail.screenTime.limitMinutes
  const [custom, setCustom] = useState(limit ?? 60)
  useEffect(() => setCustom(limit ?? 60), [limit])
  const maxUsage = Math.max(1, ...detail.usage.map((day) => day.watchedSeconds), (limit ?? 0) * 60)
  const days = [...detail.usage].reverse()

  return (
    <>
      <div className="card flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-extrabold">Limite diário</p>
            <p className="text-sm font-semibold text-muted">Ao acabar, a TV mostra "Hora de descansar". Recomeça à meia-noite.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={limit !== null}
            aria-label="Limitar tempo diário"
            className="switch switch-on"
            onClick={() => onChange(limit === null ? 60 : null)}
          />
        </div>
        {limit !== null && (
          <>
            <div className="flex flex-wrap gap-2">
              {LIMIT_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => onChange(minutes)}
                  className={`min-h-11 rounded-full px-4 font-extrabold transition-colors ${limit === minutes ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}
                >
                  {formatMinutes(minutes * 60)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-canvas p-2">
              <button type="button" className="btn btn-ghost h-11 w-14 px-0 text-xl" onClick={() => setCustom((value) => Math.max(15, value - 15))} aria-label="Menos 15 minutos">−</button>
              <span className="text-center font-display text-xl" aria-live="polite">{formatMinutes(custom * 60)}</span>
              <button type="button" className="btn btn-ghost h-11 w-14 px-0 text-xl" onClick={() => setCustom((value) => Math.min(600, value + 15))} aria-label="Mais 15 minutos">+</button>
            </div>
            {custom !== limit && (
              <button type="button" className="btn btn-primary w-full" onClick={() => onChange(custom)}>
                Salvar {formatMinutes(custom * 60)} por dia
              </button>
            )}
          </>
        )}
      </div>

      <div className="card p-5">
        <p className="font-extrabold">Últimos 7 dias</p>
        <div className="mt-4 flex h-36 gap-2" role="list" aria-label="Tempo assistido por dia">
          {days.map((day) => {
            const height = Math.max(4, (day.watchedSeconds / maxUsage) * 100)
            const over = limit !== null && day.watchedSeconds >= limit * 60
            return (
              <div key={day.day} role="listitem" className="flex flex-1 flex-col items-center gap-1" aria-label={`${dayLabel(day.day)}: ${formatMinutes(day.watchedSeconds)}`}>
                <span className="text-[10px] font-extrabold text-muted">{day.watchedSeconds ? Math.round(day.watchedSeconds / 60) : ""}</span>
                <div className="flex w-full flex-1 items-end">
                  <div className={`w-full rounded-t-lg ${over ? "bg-coral" : "bg-brand"}`} style={{ height: `${height}%`, opacity: day.watchedSeconds ? 1 : 0.15 }} />
                </div>
                <span className="text-xs font-bold capitalize text-muted">{dayLabel(day.day)}</span>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs font-semibold text-muted">Minutos assistidos por dia{limit !== null ? "; em vermelho, dias que chegaram ao limite" : ""}.</p>
      </div>
    </>
  )
}

function History({ detail }: { detail: ProfileDetail }) {
  if (!detail.history.length) {
    return (
      <div className="card p-6 text-center">
        <p className="font-display text-xl">Nada assistido ainda</p>
        <p className="mt-1 font-semibold text-muted">Os episódios que {detail.name} assistir aparecem aqui.</p>
      </div>
    )
  }
  const groups = new Map<string, typeof detail.history>()
  for (const entry of detail.history) {
    const key = historyGroup(entry.lastPlayedAt)
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([group, entries]) => (
        <section key={group}>
          <h2 className="mb-2 px-1 text-sm font-extrabold uppercase tracking-wider text-muted">{group}</h2>
          <ul className="card divide-y divide-[#f0ecfa] overflow-hidden">
            {entries.map((entry) => {
              const percent = entry.durationSeconds ? Math.min(100, (entry.positionSeconds / entry.durationSeconds) * 100) : 0
              return (
                <li key={`${entry.episodeId}-${entry.lastPlayedAt}`} className="p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate font-extrabold">{entry.title}</p>
                    <span className="shrink-0 text-xs font-bold text-muted">{formatTime(entry.lastPlayedAt)}</span>
                  </div>
                  <p className="truncate text-sm font-semibold text-muted">{entry.episodeTitle}</p>
                  {entry.completed ? (
                    <span className="mt-2 inline-block rounded-full bg-[#e3f7ee] px-2.5 py-0.5 text-xs font-extrabold text-[#1b8a62]">Assistido até o fim</span>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-soft">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-xs font-bold text-muted">{formatClock(entry.positionSeconds)}</span>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
