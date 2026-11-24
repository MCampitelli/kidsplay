import { randomInt } from 'node:crypto'

// Senha provisoria curta para o administrador passar a familia (WhatsApp, ligacao).
// Sem caracteres que se confundem (0/O, 1/I/L). Ela so serve para entrar e trocar a senha,
// expira em poucos dias e o login tem bloqueio por tentativas, o que compensa o tamanho.
export const TEMPORARY_PASSWORD_LENGTH = 5
export const TEMPORARY_PASSWORD_DAYS = 7
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateTemporaryPassword(length = TEMPORARY_PASSWORD_LENGTH) {
  let result = ''
  for (let index = 0; index < length; index++) result += ALPHABET[randomInt(ALPHABET.length)]
  return result
}

export function temporaryPasswordExpiry(now = Date.now()) {
  return new Date(now + TEMPORARY_PASSWORD_DAYS * 24 * 60 * 60 * 1000)
}
