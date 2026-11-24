import { PROFILE_STICKERS } from "../types/profile"

export function stickerEmoji(avatar: string | null, name: string) {
  return PROFILE_STICKERS.find((sticker) => sticker.id === avatar)?.emoji ?? name.charAt(0).toUpperCase()
}

/** "45 min", "1h 20min", "2h". */
export function formatMinutes(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}min` : `${hours}h`
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "short" })
const dayMonth = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" })
const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" })

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Rotulo curto de um dia "YYYY-MM-DD" (Hoje, Ontem, seg.). */
export function dayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number)
  const value = new Date(year, month - 1, date)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (day === localDayKey(today)) return "Hoje"
  if (day === localDayKey(yesterday)) return "Ontem"
  return weekday.format(value).replace(".", "")
}

/** Agrupamento do historico: "Hoje", "Ontem" ou "23/11". */
export function historyGroup(iso: string) {
  const date = new Date(iso)
  const key = localDayKey(date)
  const label = dayLabel(key)
  return label === "Hoje" || label === "Ontem" ? label : dayMonth.format(date)
}

export function formatTime(iso: string) {
  return time.format(new Date(iso))
}
