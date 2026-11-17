import type { Pool, PoolConnection } from 'mariadb'

export interface CatalogTag {
  id: number
  name: string
  slug: string
  displayOrder: number
}

export function loadPublicTitleTags(database: Pool | PoolConnection): Promise<Map<number, CatalogTag[]>>
