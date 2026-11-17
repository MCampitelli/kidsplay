import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvironment, readConfig } from '../config/environment.mjs'
import { createDatabasePool } from '../config/database.mjs'
import { hashPassword } from '../api/passwords.mjs'
const rootDirectory = process.cwd()
const env = loadEnvironment()
const config = readConfig(env)

function required(name, value) {
  if (!value?.trim()) throw new Error(`Configure ${name} no .env local antes de executar o seed.`)
  return value.trim()
}

const email = required('KIDSPLAY_TEST_USER_EMAIL', env.KIDSPLAY_TEST_USER_EMAIL)
  .toLowerCase()
const accountName = required('KIDSPLAY_TEST_USER_NAME', env.KIDSPLAY_TEST_USER_NAME || 'KidsPlay Local')
const password = required('KIDSPLAY_TEST_USER_PASSWORD', env.KIDSPLAY_TEST_USER_PASSWORD)
if (password.length < 12) throw new Error('KIDSPLAY_TEST_USER_PASSWORD precisa ter pelo menos 12 caracteres.')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('KIDSPLAY_TEST_USER_EMAIL não parece válido.')

const pool = createDatabasePool(config)

let connection
try {
  const profileData = JSON.parse(
    await readFile(path.join(rootDirectory, 'public', 'data', 'profiles.json'), 'utf8'),
  )
  if (!Array.isArray(profileData) || profileData.some((profile) => !Number.isSafeInteger(profile.id) || !profile.name)) {
    throw new Error('public/data/profiles.json não tem o formato de perfis esperado.')
  }

  connection = await pool.getConnection()
  await connection.beginTransaction()

  const users = await connection.query('SELECT id, status FROM users WHERE email = ? FOR UPDATE', [email])
  let userId
  if (users.length > 0) {
    if (users[0].status !== 'active') {
      throw new Error('A conta já existe, mas não está ativa; o seed preservou seu estado e não a alterou.')
    }
    userId = String(users[0].id)
    console.log('Conta existente preservada.')
  } else {
    const passwordHash = await hashPassword(password)
    const result = await connection.query(
      `INSERT INTO users (name, email, password_hash, status, email_verified_at)
       VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP(3))`,
      [accountName, email, passwordHash],
    )
    userId = String(result.insertId)
    console.log('Conta local de teste criada com senha armazenada apenas como hash scrypt.')
  }

  let insertedProfiles = 0
  let preservedProfiles = 0
  for (const profile of profileData) {
    const existing = await connection.query(
      'SELECT id FROM profiles WHERE owner_user_id = ? AND name = ? LIMIT 1',
      [userId, profile.name],
    )
    let profileId

    if (existing.length > 0) {
      profileId = String(existing[0].id)
      preservedProfiles += 1
    } else {
      const occupied = await connection.query('SELECT id FROM profiles WHERE id = ? LIMIT 1', [profile.id])
      if (occupied.length === 0) {
        await connection.query(
          `INSERT INTO profiles (id, owner_user_id, name, profile_type, status)
           VALUES (?, ?, ?, 'child', 'active')`,
          [profile.id, userId, profile.name],
        )
        profileId = String(profile.id)
      } else {
        const result = await connection.query(
          `INSERT INTO profiles (owner_user_id, name, profile_type, status)
           VALUES (?, ?, 'child', 'active')`,
          [userId, profile.name],
        )
        profileId = String(result.insertId)
      }
      insertedProfiles += 1
    }

    await connection.query('INSERT IGNORE INTO profile_preferences (profile_id) VALUES (?)', [profileId])
  }

  await connection.commit()
  console.log(`Seed concluído: ${insertedProfiles} perfil(is) criado(s), ${preservedProfiles} preservado(s).`)
  console.log(`E-mail local de teste: ${email}`)
  console.log('A senha usada para entrar é KIDSPLAY_TEST_USER_PASSWORD do .env local; ela não foi exibida.')
} catch (error) {
  if (connection) await connection.rollback()
  console.error(error instanceof Error ? error.message : 'Falha no seed local.')
  process.exitCode = 1
} finally {
  connection?.release()
  await pool.end()
}