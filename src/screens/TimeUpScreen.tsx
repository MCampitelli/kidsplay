import { useEffect, useRef } from "react"
import type { Profile } from "../types/profile"

/** Tela mostrada quando o limite diario definido na Area dos Pais acaba. */
export function TimeUpScreen({
  profile,
  onSwitchProfile,
}: {
  profile: Profile
  onSwitchProfile: () => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    buttonRef.current?.focus()
  }, [])

  return (
    <main className="relative flex min-h-screen items-center justify-center px-8 py-10 text-white">
      <div className="app-backdrop" aria-hidden="true" />
      <section className="relative z-10 flex max-w-2xl flex-col items-center text-center">
        <span className="flex h-28 w-28 items-center justify-center rounded-full bg-[#FFD93D] text-[#1a1030] shadow-2xl" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-16 w-16" fill="currentColor">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
          </svg>
        </span>
        <h1 className="mt-8 font-display text-5xl drop-shadow-lg sm:text-6xl">Hora de descansar!</h1>
        <p className="mt-5 text-xl font-bold text-white/90 sm:text-2xl">
          {profile.name}, o tempo de desenhos de hoje acabou. Amanhã tem mais!
        </p>
        <button
          ref={buttonRef}
          type="button"
          onClick={onSwitchProfile}
          className="tv-pill mt-10"
          data-tv-focusable
        >
          Trocar perfil
        </button>
      </section>
    </main>
  )
}
