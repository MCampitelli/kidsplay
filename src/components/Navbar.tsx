import type { Profile } from "../types/profile"

export function Navbar({
  onLogout,
  onSwitchProfile,
  currentUser,
}: {
  onLogout: () => void
  onSwitchProfile: () => void
  currentUser: Profile
}) {
  return (
    <nav className="sticky top-0 z-50 bg-gradient-to-b from-black/70 to-transparent">
      <div className="px-8 sm:px-14 py-3 flex items-center justify-between h-20">
        <div className="flex items-center gap-3 flex-shrink-0">
          <img
            src="/logo_kids_play.png"
            alt="KidsPlay"
            className="h-12 w-auto drop-shadow"
          />
          <span className="font-display text-3xl text-white drop-shadow">KidsPlay</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-full bg-black/40 px-4 py-2 text-base font-bold text-white sm:inline-flex">
            {currentUser.name}
          </span>
          <button
            onClick={onSwitchProfile}
            className="px-4 py-2 bg-[#FFD93D] hover:bg-[#f0c82e] text-[#2D2D2D] font-bold rounded-full text-sm transition-all"
            data-tv-focusable
          >
            Trocar perfil
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2 bg-[#FF6B6B] hover:bg-[#e85555] text-white font-bold rounded-full text-sm transition-all"
            data-tv-focusable
          >
            Sair
          </button>
        </div>
      </div>
    </nav>
  )
}
