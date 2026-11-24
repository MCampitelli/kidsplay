import { apiFetch } from "../services/apiClient"

export interface ScreenTime {
  limitMinutes: number | null
  watchedSeconds: number
  remainingSeconds: number | null
}

export interface NowWatching {
  episodeId: number
  episodeTitle: string
  titleId: number
  title: string
  positionSeconds: number
  durationSeconds: number
}

export interface ProfileSummary {
  id: number
  name: string
  avatar: string | null
  blockedCount: number
  screenTime: ScreenTime
  nowWatching: NowWatching | null
}

export interface HistoryEntry {
  episodeId: number
  episodeTitle: string
  titleId: number
  title: string
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  lastPlayedAt: string
}

export interface ProfileDetail {
  id: number
  name: string
  avatar: string | null
  screenTime: ScreenTime
  nowWatching: NowWatching | null
  titles: Array<{ id: number; title: string; image: string | null; blocked: boolean }>
  usage: Array<{ day: string; watchedSeconds: number }>
  history: HistoryEntry[]
}

export interface Suggestion {
  id: number
  titleName: string
  note: string | null
  status: "pending" | "added" | "declined"
  adminNote: string | null
  profileName: string | null
  createdAt: string
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, {
    cache: "no-store",
    ...init,
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new ApiError(data?.error ?? "Não foi possível falar com o KidsPlay.", response.status)
  return data as T
}

export const familyApi = {
  overview: () => request<{ profiles: ProfileSummary[] }>("/api/family/overview"),
  profile: (id: number) => request<ProfileDetail>(`/api/family/profiles/${id}`),
  updateControls: (id: number, controls: { dailyLimitMinutes?: number | null; blockedTitleIds?: number[] }) =>
    request<ProfileDetail>(`/api/family/profiles/${id}/controls`, { method: "PUT", body: JSON.stringify(controls) }),
  suggestions: () => request<Suggestion[]>("/api/family/suggestions"),
  suggest: (input: { titleName: string; note?: string; profileId?: number | null }) =>
    request<Suggestion[]>("/api/family/suggestions", { method: "POST", body: JSON.stringify(input) }),
}
