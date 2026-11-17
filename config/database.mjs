import mariadb from 'mariadb'

/** @param {ReturnType<import('./environment.mjs').readConfig>} config */
export function createDatabasePool(config) {
  return mariadb.createPool({
    ...config.database,
    connectionLimit: 5,
    connectTimeout: 5_000,
    acquireTimeout: 10_000,
    charset: 'utf8mb4',
  })
}
