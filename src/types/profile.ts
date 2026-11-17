export const PROFILE_STICKERS = [
  { id: "rocket", label: "Foguete", emoji: "🚀" },
  { id: "car", label: "Carrinho", emoji: "🚗" },
  { id: "doll", label: "Boneca", emoji: "🪆" },
  { id: "teddy", label: "Ursinho", emoji: "🧸" },
  { id: "ball", label: "Bola", emoji: "⚽" },
  { id: "dinosaur", label: "Dinossauro", emoji: "🦖" },
  { id: "cat", label: "Gatinho", emoji: "🐱" },
  { id: "star", label: "Estrela", emoji: "⭐" },
] as const

export type ProfileStickerId = (typeof PROFILE_STICKERS)[number]["id"]

export function isProfileStickerId(value: unknown): value is ProfileStickerId {
  return PROFILE_STICKERS.some((sticker) => sticker.id === value)
}

export interface Profile {
  id: number
  name: string
  avatar: ProfileStickerId | null
}

export interface ProfileInput {
  name: string
  avatar: ProfileStickerId
}
