import { useState, type FormEvent } from "react"
import { Notice } from "../components"

export function LoginView({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    try {
      await onLogin(email.trim(), password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="safe-top safe-bottom flex min-h-dvh flex-col bg-brand text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <img src="/logo_kids_play.png" alt="KidsPlay" className="mx-auto h-28 w-28 drop-shadow-xl" />
        <h1 className="mt-4 text-center font-display text-4xl">Área dos Pais</h1>
        <p className="mt-2 text-center font-semibold text-white/75">
          Entre com a mesma conta do KidsPlay para acompanhar e controlar o que as crianças assistem.
        </p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-3 rounded-[2rem] bg-white p-5 text-ink shadow-2xl">
          <label className="text-sm font-extrabold" htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field"
          />
          <label className="mt-1 text-sm font-extrabold" htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
          />
          {error && <Notice>{error}</Notice>}
          <button type="submit" disabled={busy} className="btn btn-primary mt-2 w-full text-lg">
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  )
}
