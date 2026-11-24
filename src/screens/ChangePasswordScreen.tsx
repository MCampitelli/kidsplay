import { useState, type FormEvent } from "react"

const MIN_LENGTH = 8

/**
 * Primeiro acesso com a senha provisoria (TV): a familia cria a propria senha.
 * A senha provisoria ja foi digitada no login, entao vem preenchida.
 */
export function ChangePasswordScreen({
  temporaryPassword,
  onSubmit,
  onCancel,
}: {
  temporaryPassword: string
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>
  onCancel: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState(temporaryPassword)
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < MIN_LENGTH) return setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`)
    if (newPassword !== confirmation) return setError("As duas senhas não são iguais.")
    setIsSubmitting(true)
    setError("")
    try {
      await onSubmit(currentPassword, newPassword)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível trocar a senha.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const field = "w-full rounded-2xl border-2 border-[#FFD93D] bg-[#FFF8F0] px-4 py-3 outline-none"

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4">
      <div className="app-backdrop" aria-hidden="true" />
      <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-sm rounded-3xl bg-white/90 p-7 shadow-xl">
        <h1 className="font-display text-3xl text-[#2D2D2D] text-center">Crie sua senha</h1>
        <p className="mt-2 mb-6 text-center text-sm font-semibold text-[#5A5A5A]">
          Você entrou com uma senha provisória. Escolha uma senha sua, com pelo menos {MIN_LENGTH} caracteres.
        </p>
        <div className="space-y-4">
          {!temporaryPassword && (
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="Senha provisória"
              aria-label="Senha provisória"
              className={field}
            />
          )}
          <input
            autoFocus
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Nova senha"
            aria-label="Nova senha"
            className={field}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Repita a nova senha"
            aria-label="Repita a nova senha"
            className={field}
          />
        </div>
        {error && <p className="mt-3 text-center text-sm font-bold text-[#FF6B6B]">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-full bg-[#FF6B6B] px-5 py-3 font-bold text-white transition-colors hover:bg-[#e85555] disabled:opacity-60"
          data-tv-focusable
        >
          Salvar e entrar
        </button>
        <button type="button" onClick={onCancel} className="mt-3 w-full rounded-full px-5 py-2 text-sm font-bold text-[#5A5A5A]" data-tv-focusable>
          Sair
        </button>
      </form>
    </div>
  )
}
