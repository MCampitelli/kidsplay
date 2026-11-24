import { apiFetch } from "./apiClient"

export interface ScreenTime {
  limitMinutes: number | null
  watchedSeconds: number
  /** null quando o perfil nao tem limite diario. */
  remainingSeconds: number | null
}

export interface ProgressInput {
  profileId: number
  episodeId: number
  positionSeconds: number
  durationSeconds: number
  /** Segundos efetivamente assistidos desde o ultimo envio (conta para o limite diario). */
  watchedSeconds: number
  completed?: boolean
}

export async function getScreenTime(profileId: number): Promise<ScreenTime> {
  const response = await apiFetch(`/api/profiles/${profileId}/screen-time`, { cache: "no-store" })
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}`)
  return response.json()
}

/** Envia o progresso do episodio; `keepalive` garante o envio mesmo ao fechar o player. */
export async function sendProgress(input: ProgressInput, { keepalive = false } = {}): Promise<ScreenTime | null> {
  const response = await apiFetch("/api/playback/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    keepalive,
  })
  if (!response.ok) return null
  return response.json()
}
