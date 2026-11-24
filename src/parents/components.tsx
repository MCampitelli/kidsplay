import type { ReactNode } from "react"
import type { NowWatching, ScreenTime } from "./api"
import { formatClock, formatMinutes, stickerEmoji } from "./format"

export function TopBar({
  title,
  onBack,
  right,
}: {
  title: string
  onBack?: () => void
  right?: ReactNode
}) {
  return (
    <header className="safe-top sticky top-0 z-20 bg-brand text-white shadow-lg shadow-brand/20">
      <div className="mx-auto flex h-16 max-w-2xl items-center gap-2 px-3">
        {onBack ? (
          <button type="button" onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Voltar">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        ) : (
          <img src="/logo_kids_play.png" alt="" className="ml-1 h-10 w-10" />
        )}
        <h1 className="min-w-0 flex-1 truncate font-display text-xl">{title}</h1>
        {right}
      </div>
    </header>
  )
}

export function Avatar({ avatar, name, size = "md" }: { avatar: string | null; name: string; size?: "md" | "lg" }) {
  const classes = size === "lg" ? "h-20 w-20 text-5xl" : "h-14 w-14 text-3xl"
  return (
    <span className={`flex ${classes} shrink-0 items-center justify-center rounded-full bg-sun shadow-inner`} aria-hidden="true">
      {stickerEmoji(avatar, name)}
    </span>
  )
}

/** Tempo assistido hoje, com barra quando ha limite diario. */
export function ScreenTimeBar({ screenTime, compact = false }: { screenTime: ScreenTime; compact?: boolean }) {
  const { limitMinutes, watchedSeconds, remainingSeconds } = screenTime
  if (limitMinutes === null) {
    return <p className="text-sm font-bold text-muted">Hoje: {formatMinutes(watchedSeconds)} · sem limite</p>
  }
  const percent = Math.min(100, (watchedSeconds / (limitMinutes * 60)) * 100)
  const finished = remainingSeconds === 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm font-bold">
        <span className={finished ? "text-coral" : "text-ink"}>
          {finished ? "Tempo de hoje esgotado" : `Hoje: ${formatMinutes(watchedSeconds)}`}
        </span>
        <span className="text-muted">limite {formatMinutes(limitMinutes * 60)}</span>
      </div>
      <div className={`mt-2 overflow-hidden rounded-full bg-brand-soft ${compact ? "h-2" : "h-3"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${finished ? "bg-coral" : percent > 80 ? "bg-[#ff9f43]" : "bg-mint"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function NowWatchingBadge({ nowWatching }: { nowWatching: NowWatching | null }) {
  if (!nowWatching) return <p className="text-sm font-semibold text-muted">Não está assistindo agora</p>
  return (
    <p className="flex items-center gap-2 text-sm font-bold text-mint">
      <span className="live-dot" aria-hidden="true" />
      <span className="truncate">Assistindo: {nowWatching.title}</span>
    </p>
  )
}

export function NowWatchingCard({ nowWatching }: { nowWatching: NowWatching | null }) {
  if (!nowWatching) {
    return (
      <div className="card flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="12" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </span>
        <div>
          <p className="font-extrabold">Nada passando agora</p>
          <p className="text-sm text-muted">Quando um desenho estiver tocando, ele aparece aqui.</p>
        </div>
      </div>
    )
  }
  const percent = nowWatching.durationSeconds ? Math.min(100, (nowWatching.positionSeconds / nowWatching.durationSeconds) * 100) : 0
  return (
    <div className="card overflow-hidden p-5">
      <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-mint">
        <span className="live-dot" aria-hidden="true" /> Assistindo agora
      </p>
      <p className="mt-2 font-display text-xl leading-tight">{nowWatching.title}</p>
      <p className="mt-1 font-bold text-muted">{nowWatching.episodeTitle}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-soft">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-2 text-xs font-bold text-muted">
        {formatClock(nowWatching.positionSeconds)} de {formatClock(nowWatching.durationSeconds)}
      </p>
    </div>
  )
}

export function Notice({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-2xl px-4 py-3 text-sm font-bold ${tone === "error" ? "bg-[#ffe8e8] text-[#c93a3a]" : "bg-[#e3f7ee] text-[#1b8a62]"}`}>
      {children}
    </p>
  )
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Carregando">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-brand-soft border-t-brand" />
    </div>
  )
}
