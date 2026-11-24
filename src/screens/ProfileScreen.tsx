import { useEffect, useState } from "react"
import { PROFILE_STICKERS, type Profile } from "../types/profile"

/** "Quem vai assistir?": os perfis sao criados e controlados na Area dos Pais (celular). */
export function ProfileScreen({
  profiles,
  onLogin,
  onLogout,
}: {
  profiles: Profile[]
  onLogin: (profile: Profile) => void
  onLogout: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  // O ultimo item da navegacao (indice = profiles.length) e o botao "Sair".
  const logoutIndex = profiles.length
  const parentsUrl = `${window.location.origin}/pais/`

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : logoutIndex))
        event.preventDefault()
      } else if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev < logoutIndex ? prev + 1 : 0))
        event.preventDefault()
      } else if (event.key === "Enter") {
        if (selectedIndex === logoutIndex) onLogout()
        else onLogin(profiles[selectedIndex])
        event.preventDefault()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedIndex, profiles, logoutIndex, onLogin, onLogout])

  return (
    <div className="relative min-h-screen flex items-center px-8 sm:px-16 py-10">
      <div className="app-backdrop" aria-hidden="true" />

      <div className="relative z-10 flex w-full items-center gap-10">
        <section className="flex w-full max-w-md flex-col">
          <h1 className="text-4xl sm:text-5xl font-display text-white drop-shadow-lg mb-8">
            Quem vai assistir?
          </h1>

          {profiles.length === 0 && (
            <p className="mb-6 rounded-3xl bg-black/45 px-6 py-5 text-lg font-bold text-white">
              Nenhum perfil ainda. Crie os perfis das crianças na Área dos Pais, pelo celular:
              <span className="mt-2 block break-all text-[#FFD93D]">{parentsUrl}</span>
            </p>
          )}

          <div className="flex flex-col gap-4">
            {profiles.map((profile, index) => {
              const isSelected = index === selectedIndex
              const sticker = PROFILE_STICKERS.find((item) => item.id === profile.avatar)
              return (
                <div
                  key={profile.id}
                  data-tv-focusable
                  tabIndex={0}
                  role="button"
                  aria-label={`Entrar como ${profile.name}`}
                  className={`flex origin-left cursor-pointer items-center gap-5 rounded-full border-4 py-2 pl-2 pr-8 transition-all duration-300 ${
                    isSelected
                      ? "scale-[1.03] border-[#FFD93D] bg-black/55 shadow-2xl"
                      : "border-transparent bg-black/30 opacity-70"
                  }`}
                  onClick={() => onLogin(profile)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onLogin(profile)
                  }}
                >
                  <div
                    className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full text-5xl font-bold shadow-lg"
                    style={{
                      background: isSelected ? "#FF6B6B" : "#FFD93D",
                      color: isSelected ? "white" : "#2D2D2D",
                    }}
                  >
                    {sticker?.emoji ?? profile.name.charAt(0)}
                  </div>
                  <p className="truncate text-2xl font-extrabold text-white drop-shadow">
                    {profile.name}
                  </p>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={onLogout}
            onMouseEnter={() => setSelectedIndex(logoutIndex)}
            className={`tv-pill mt-8 self-start ${selectedIndex === logoutIndex ? "tv-pill-active" : ""}`}
            data-tv-focusable
          >
            Sair da conta
          </button>
        </section>

        <div className="hidden flex-1 items-center justify-center md:flex">
          <img
            src="/logo_kids_play.png"
            alt="KidsPlay"
            className="logo-glow w-full max-w-[560px] h-auto"
          />
        </div>
      </div>
    </div>
  )
}
