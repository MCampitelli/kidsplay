export interface AuthenticatedAccount {
  id: number
  name: string
  email: string
  role: 'user' | 'admin'
  /** Conta entrou com a senha provisoria: precisa criar a propria senha antes de usar o app. */
  mustChangePassword: boolean
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? 'Não foi possível concluir a autenticação.'
  } catch {
    return 'Não foi possível concluir a autenticação.'
  }
}

export async function login(email: string, password: string): Promise<AuthenticatedAccount> {
  const response = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { user: AuthenticatedAccount }
  return data.user
}

export async function getSession(): Promise<AuthenticatedAccount | null> {
  const response = await apiFetch('/api/auth/session')
  if (response.status === 401) return null
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { user: AuthenticatedAccount }
  return data.user
}

export async function logout(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  if (!response.ok) throw new Error(await readError(response))
}
import { apiFetch } from './apiClient'

/** Troca a senha (obrigatoria no primeiro acesso com a senha provisoria). */
export async function changePassword(currentPassword: string, newPassword: string): Promise<AuthenticatedAccount> {
  const response = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!response.ok) throw new Error(await readError(response))
  const data = (await response.json()) as { user: AuthenticatedAccount }
  return data.user
}
