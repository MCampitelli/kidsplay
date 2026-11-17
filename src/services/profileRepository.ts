import type { Profile, ProfileInput } from "../types/profile"
import { apiFetch } from "./apiClient"

/** Storage-agnostic contract for profile persistence. */
export interface ProfileRepository {
  getAll(): Promise<Profile[]>
  getById(id: number): Promise<Profile | null>
  create(input: ProfileInput): Promise<Profile>
  update(id: number, input: ProfileInput): Promise<Profile>
  delete(id: number): Promise<void>
}

const API_PROFILES_URL = "/api/profiles"

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

/** Profiles are read and written by the authenticated local MariaDB API. */
export class ApiProfileRepository implements ProfileRepository {
  async getAll(): Promise<Profile[]> {
    const response = await apiFetch(API_PROFILES_URL)
    const data = await parseJsonResponse(response)
    if (!response.ok) throw new Error(data?.error ?? "Não foi possível carregar os perfis.")
    return (data ?? []) as Profile[]
  }

  async getById(id: number): Promise<Profile | null> {
    const profiles = await this.getAll()
    return profiles.find((profile) => profile.id === id) ?? null
  }

  async create(input: ProfileInput): Promise<Profile> {
    const response = await apiFetch(API_PROFILES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    const data = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(
        data?.error ??
          "Não foi possível criar o perfil.",
      )
    }
    return data as Profile
  }

  async update(id: number, input: ProfileInput): Promise<Profile> {
    const response = await apiFetch(`${API_PROFILES_URL}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    const data = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(
        data?.error ??
          "Não foi possível atualizar o perfil.",
      )
    }
    return data as Profile
  }

  async delete(id: number): Promise<void> {
    const response = await apiFetch(`${API_PROFILES_URL}/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } })
    if (response.status === 204) return
    if (!response.ok) {
      const data = await parseJsonResponse(response)
      throw new Error(
        data?.error ??
          "Não foi possível excluir o perfil.",
      )
    }
  }
}
