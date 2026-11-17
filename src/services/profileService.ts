import type { Profile, ProfileInput } from "../types/profile"
import { ApiProfileRepository, type ProfileRepository } from "./profileRepository"

function favoriteStorageKey(profileId: number) {
  return `kidsplay-favorite-shows-${profileId}`
}

function normalizeName(name: string) {
  return name.trim()
}

/**
 * Business rules for profile administration. UI components call these
 * methods only — they never talk to the repository or to `fetch` directly,
 * so the persistence strategy (JSON today, API/DB tomorrow) can change
 * without touching `AdminPanel`, `ProfileForm`, `ProfileSelector`, etc.
 */
export class ProfileService {
  constructor(private readonly repository: ProfileRepository = new ApiProfileRepository()) {}

  getProfiles(): Promise<Profile[]> {
    return this.repository.getAll()
  }

  getProfile(id: number): Promise<Profile | null> {
    return this.repository.getById(id)
  }

  async createProfile(input: ProfileInput): Promise<Profile> {
    const name = normalizeName(input.name)
    if (!name) throw new Error("O nome do perfil é obrigatório.")
    return this.repository.create({ name, avatar: input.avatar })
  }

  async updateProfile(id: number, input: ProfileInput): Promise<Profile> {
    const name = normalizeName(input.name)
    if (!name) throw new Error("O nome do perfil é obrigatório.")
    return this.repository.update(id, { name, avatar: input.avatar })
  }

  async deleteProfile(id: number): Promise<void> {
    await this.repository.delete(id)
    // Favorites are stored per-profile in localStorage; remove them together
    // with the profile so no orphaned data is left behind (see ProfileScreen).
    try {
      localStorage.removeItem(favoriteStorageKey(id))
    } catch {
      // ignore storage access errors (e.g. private browsing)
    }
  }
}

export const profileService = new ProfileService()
