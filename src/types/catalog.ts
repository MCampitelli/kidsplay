// Catalog shapes returned by GET /api/catalog.

export interface Episode {
  id: number
  title: string
  file: string
  hls?: string
  image?: string
}

export interface Show {
  id: number
  title: string
  description?: string | null
  color: string
  image?: string
  banner?: string
  episodes: Episode[]
  tags: { id: number; name: string; slug: string; displayOrder: number }[]
}
