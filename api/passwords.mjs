import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const COST = 16_384
const BLOCK_SIZE = 8
const PARALLELIZATION = 1
const KEY_LENGTH = 64
const MAX_MEMORY = 64 * 1024 * 1024

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  })
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, costText, blockText, parallelText, saltHex, keyHex] = storedHash.split('$')
  if (
    algorithm !== 'scrypt' ||
    !costText ||
    !blockText ||
    !parallelText ||
    !saltHex ||
    !keyHex ||
    !/^\d+$/.test(costText) ||
    !/^\d+$/.test(blockText) ||
    !/^\d+$/.test(parallelText) ||
    !/^[a-f\d]+$/i.test(saltHex) ||
    !/^[a-f\d]+$/i.test(keyHex)
  ) {
    return false
  }

  const expected = Buffer.from(keyHex, 'hex')
  if (expected.length !== KEY_LENGTH) return false
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(costText),
    r: Number(blockText),
    p: Number(parallelText),
    maxmem: MAX_MEMORY,
  })
  return timingSafeEqual(derived, expected)
}
