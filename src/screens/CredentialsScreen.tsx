import { useState, type FormEvent } from "react"

export function CredentialsScreen({
  onLogin,
}: {
  onLogin: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      await onLogin(email, password)
      setError("")
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4">
      <div className="app-backdrop" aria-hidden="true" />
      <img
        src="/logo_kids_play.png"
        alt="KidsPlay"
        className="relative z-10 h-28 w-auto mb-10 logo-glow"
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-3xl bg-white/90 p-7 shadow-xl"
      >
        <h1 className="font-display text-3xl text-[#2D2D2D] text-center mb-6">
          Entrar
        </h1>
        <div className="space-y-4">
          <input
            autoFocus
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="E-mail"
            aria-label="E-mail"
            className="w-full rounded-2xl border-2 border-[#FFD93D] bg-[#FFF8F0] px-4 py-3 outline-none"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha"
            aria-label="Senha"
            className="w-full rounded-2xl border-2 border-[#FFD93D] bg-[#FFF8F0] px-4 py-3 outline-none"
          />
        </div>
        {error && (
          <p className="mt-3 text-center text-sm font-bold text-[#FF6B6B]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-full bg-[#FF6B6B] px-5 py-3 font-bold text-white transition-colors hover:bg-[#e85555] disabled:opacity-60"
          data-tv-focusable
        >
          Continuar
        </button>
      </form>
    </div>
  )
}
