import { useEffect, useRef, useState } from "react"
import type { Profile } from "../types/profile"

// Cabecalho ancorado no topo da pagina (rola junto com o conteudo, nao fica fixo).
// As acoes da conta ficam num menu para nao disputar espaco nem foco com o catalogo.
export function Navbar({
  onLogout,
  onSwitchProfile,
  currentUser,
}: {
  onLogout: () => void
  onSwitchProfile: () => void
  currentUser: Profile
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    firstItemRef.current?.focus({ preventScroll: true })
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer)
  }, [menuOpen])

  const closeMenu = () => {
    setMenuOpen(false)
    menuButtonRef.current?.focus({ preventScroll: true })
  }

  return (
    <nav className="relative z-50 bg-gradient-to-b from-black/70 to-transparent">
      <div className="px-8 sm:px-14 py-3 flex items-center justify-between h-20">
        <div className="flex items-center gap-3 flex-shrink-0">
          <img
            src="/logo_kids_play.png"
            alt="KidsPlay"
            className="h-12 w-auto drop-shadow"
          />
          <span className="font-display text-3xl text-white drop-shadow">KidsPlay</span>
        </div>

        <div
          ref={menuRef}
          className="relative flex items-center gap-3"
          onKeyDown={(event) => {
            // Esc/Voltar fecha o menu sem sair da tela atual.
            if (menuOpen && (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack")) {
              event.preventDefault()
              event.stopPropagation()
              closeMenu()
            }
          }}
          onBlur={(event) => {
            // Foco saiu do menu (ex.: setas do controle): fecha.
            if (menuOpen && !menuRef.current?.contains(event.relatedTarget as Node | null)) setMenuOpen(false)
          }}
        >
          <span className="hidden rounded-full bg-black/40 px-4 py-2 text-base font-bold text-white sm:inline-flex">
            {currentUser.name}
          </span>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="navbar-menu-button"
            aria-label="Menu da conta"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-tv-focusable
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {menuOpen && (
            <div role="menu" className="navbar-menu">
              <button
                ref={firstItemRef}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onSwitchProfile()
                }}
                className="navbar-menu-item"
                data-tv-focusable
              >
                Trocar perfil
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
                className="navbar-menu-item navbar-menu-item-danger"
                data-tv-focusable
              >
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
