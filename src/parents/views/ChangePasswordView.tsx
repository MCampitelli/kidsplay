import { useState, type FormEvent } from "react"
import { Notice } from "../components"

const MIN_LENGTH = 8

/** Primeiro acesso com a senha provisoria: a familia cria a propria senha. */
export function ChangePasswordView({
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
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (newPassword.length < MIN_LENGTH) return setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`)
    if (newPassword !== confirmation) return setError("As duas senhas não são iguais.")
    setError("")
    setBusy(true)
    try {
      await onSubmit(currentPassword, newPassword)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível trocar a senha.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col bg-brand text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <img src="/logo_kids_play.png" alt="" className="mx-auto h-20 w-20 drop-shadow-xl" />
        <h1 className="mt-4 text-center font-display text-3xl">Crie sua senha</h1>
        <p className="mt-2 text-center font-semibold text-white/75">
          Você entrou com uma senha provisória. Escolha uma senha sua, com pelo menos {MIN_LENGTH} caracteres. Ela vale para a TV e para a Área dos Pais.
        </p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-3 rounded-[2rem] bg-white p-5 text-ink shadow-2xl">
          {!temporaryPassword && (
            <>
              <label className="text-sm font-extrabold" htmlFor="current-password">Senha provisória</label>
              <input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="field" />
            </>
          )}
          <label className="text-sm font-extrabold" htmlFor="new-password">Nova senha</label>
          <input id="new-password" type="password" autoComplete="new-password" required minLength={MIN_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="field" />
          <label className="mt-1 text-sm font-extrabold" htmlFor="confirm-password">Repita a nova senha</label>
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={MIN_LENGTH} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="field" />
          {error && <Notice>{error}</Notice>}
          <button type="submit" disabled={busy} className="btn btn-primary mt-2 w-full text-lg">
            {busy ? "Salvando..." : "Salvar e entrar"}
          </button>
          <button type="button" onClick={onCancel} className="btn w-full text-muted">Sair</button>
        </form>
      </div>
    </main>
  )
}
