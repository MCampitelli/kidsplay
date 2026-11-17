import { useEffect, useState } from "react"
import { PROFILE_STICKERS, type Profile, type ProfileStickerId } from "../types/profile"
import { profileService } from "../services/profileService"
import { ProfileFormDialog } from "./ProfileFormDialog"
import { ConfirmDialog } from "./ConfirmDialog"

type Zone = "row" | "actions" | "logout"

function ProfileTile({
  name,
  avatar,
  isAdd,
  isFocused,
  onSelect,
}: {
  name: string
  avatar?: ProfileStickerId | null
  isAdd?: boolean
  isFocused: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-tv-focusable
      className={`flex min-w-0 flex-1 origin-left items-center gap-5 rounded-full border-4 py-2 pl-2 pr-8 text-left transition-all duration-300 ${
        isFocused
          ? "scale-[1.03] border-[#FFD93D] bg-black/55 shadow-2xl"
          : "border-transparent bg-black/30 opacity-70"
      }`}
    >
      <span
        className={`flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full font-display text-5xl shadow-lg ${
          isAdd ? "border-4 border-dashed" : ""
        }`}
        style={{
          background: isAdd ? "transparent" : isFocused ? "#FF6B6B" : "#FFD93D",
          borderColor: isAdd ? "#4ECDC4" : undefined,
          color: isAdd ? "#4ECDC4" : isFocused ? "#fff" : "#2D2D2D",
        }}
      >
        {isAdd ? "+" : avatar ? PROFILE_STICKERS.find((sticker) => sticker.id === avatar)?.emoji : name.charAt(0).toUpperCase()}
      </span>
      <span className="truncate text-2xl font-extrabold text-white drop-shadow">
        {name}
      </span>
    </button>
  )
}

export function AdminPanel({
  profiles,
  onProfilesChange,
  onEnterProfile,
  onLogout,
}: {
  profiles: Profile[]
  onProfilesChange: (profiles: Profile[]) => void
  onEnterProfile: (profile: Profile) => void
  onLogout: () => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [zone, setZone] = useState<Zone>("row")
  const [actionIndex, setActionIndex] = useState(0)
  const [formState, setFormState] = useState<{
    mode: "create" | "edit"
    profile?: Profile
  } | null>(null)
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null)
  const [errorMessage, setErrorMessage] = useState("")

  const addTileIndex = profiles.length
  const totalRowItems = profiles.length + 1

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, addTileIndex))
  }, [addTileIndex])

  function openEdit(profile: Profile) {
    setFormState({ mode: "edit", profile })
  }

  function openDelete(profile: Profile) {
    setProfileToDelete(profile)
  }

  async function handleSubmitForm(name: string, avatar: ProfileStickerId) {
    if (formState?.mode === "edit" && formState.profile) {
      const updated = await profileService.updateProfile(formState.profile.id, { name, avatar })
      onProfilesChange(
        profiles.map((profile) => (profile.id === updated.id ? updated : profile)),
      )
    } else {
      const created = await profileService.createProfile({ name, avatar })
      onProfilesChange([...profiles, created])
      setSelectedIndex(profiles.length)
    }
    setErrorMessage("")
    setZone("row")
    setFormState(null)
  }

  async function handleConfirmDelete() {
    if (!profileToDelete) return
    try {
      await profileService.deleteProfile(profileToDelete.id)
      onProfilesChange(profiles.filter((profile) => profile.id !== profileToDelete.id))
      setErrorMessage("")
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Não foi possível excluir o perfil.",
      )
    } finally {
      setProfileToDelete(null)
      setZone("row")
    }
  }

  // Self-contained TV remote navigation (mirrors ProfileScreen): arrow keys move
  // a virtual selection across rows/zones instead of relying on real DOM focus.
  useEffect(() => {
    if (formState || profileToDelete) return

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      )
        return

      if (zone === "row") {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => Math.max(i - 1, 0))
          event.preventDefault()
        } else if (event.key === "ArrowDown") {
          if (selectedIndex === addTileIndex) setZone("logout")
          else setSelectedIndex((i) => Math.min(i + 1, totalRowItems - 1))
          event.preventDefault()
        } else if (event.key === "ArrowRight") {
          if (selectedIndex !== addTileIndex) {
            setZone("actions")
            setActionIndex(0)
          }
          event.preventDefault()
        } else if (event.key === "Enter") {
          if (selectedIndex === addTileIndex) {
            setFormState({ mode: "create" })
          } else {
            const profile = profiles[selectedIndex]
            if (profile) onEnterProfile(profile)
          }
          event.preventDefault()
        }
        return
      }

      if (zone === "actions") {
        const profile = profiles[selectedIndex]
        if (!profile) {
          setZone("row")
          return
        }
        if (event.key === "ArrowRight") {
          setActionIndex(1)
          event.preventDefault()
        } else if (event.key === "ArrowLeft") {
          if (actionIndex === 0) setZone("row")
          else setActionIndex(0)
          event.preventDefault()
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          setZone("row")
          event.preventDefault()
        } else if (event.key === "Enter") {
          if (actionIndex === 0) openEdit(profile)
          else openDelete(profile)
          event.preventDefault()
        }
        return
      }

      if (zone === "logout") {
        if (event.key === "ArrowUp") {
          setZone("row")
          event.preventDefault()
        } else if (event.key === "Enter") {
          onLogout()
          event.preventDefault()
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    zone,
    selectedIndex,
    actionIndex,
    profiles,
    addTileIndex,
    totalRowItems,
    formState,
    profileToDelete,
    onEnterProfile,
    onLogout,
  ])

  return (
    <div className="relative min-h-screen flex items-center px-8 sm:px-16 py-10">
      <div className="app-backdrop" aria-hidden="true" />

      <div className="relative z-10 flex w-full items-center gap-10">
        <section className="flex w-full max-w-xl flex-col">
          <h1 className="font-display text-4xl sm:text-5xl text-white drop-shadow-lg">
            Quem é você?
          </h1>

          <div className="min-h-10 flex items-center">
            {errorMessage && (
              <p className="rounded-full bg-[#FFE1E1] px-5 py-1.5 text-sm font-bold text-[#FF6B6B]">
                {errorMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4" role="list" aria-label="Perfis">
            {profiles.map((profile, index) => {
              const isRowFocused = zone === "row" && selectedIndex === index
              const isActive = zone !== "logout" && selectedIndex === index
              const inActions = isActive && zone === "actions"
              return (
                <div key={profile.id} className="flex items-center gap-8" role="listitem">
                  <ProfileTile
                    name={profile.name}
                    avatar={profile.avatar}
                    isFocused={isRowFocused}
                    onSelect={() => {
                      setSelectedIndex(index)
                      onEnterProfile(profile)
                    }}
                  />
                  <div
                    className={`flex w-56 flex-shrink-0 items-center gap-2 transition-opacity ${
                      isActive ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                  >
                    <button
                      type="button"
                      data-tv-focusable
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => openEdit(profile)}
                      className={`rounded-full px-4 py-2 text-base font-bold transition-all ${
                        inActions && actionIndex === 0
                          ? "bg-[#FFD93D] text-[#2D2D2D] scale-110"
                          : "bg-black/40 text-white/80"
                      }`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      data-tv-focusable
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => openDelete(profile)}
                      className={`rounded-full px-4 py-2 text-base font-bold transition-all ${
                        inActions && actionIndex === 1
                          ? "bg-[#FF6B6B] text-white scale-110"
                          : "bg-black/40 text-white/80"
                      }`}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )
            })}

            <div className="flex items-center gap-8" role="listitem">
              <ProfileTile
                name="Adicionar"
                isAdd
                isFocused={zone === "row" && selectedIndex === addTileIndex}
                onSelect={() => {
                  setSelectedIndex(addTileIndex)
                  setFormState({ mode: "create" })
                }}
              />
              <div className="w-56 flex-shrink-0" aria-hidden="true" />
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            data-tv-focusable
            className={`mt-8 self-start rounded-full px-8 py-3 text-lg font-bold transition-all ${
              zone === "logout"
                ? "bg-[#FFD93D] text-[#2D2D2D] scale-105"
                : "bg-black/40 text-white"
            }`}
          >
            Sair
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

      {formState && (
        <ProfileFormDialog
          mode={formState.mode}
          initialProfile={formState.profile}
          existingNames={profiles.map((profile) => profile.name)}
          onCancel={() => setFormState(null)}
          onSubmit={handleSubmitForm}
        />
      )}

      {profileToDelete && (
        <ConfirmDialog
          title="Excluir perfil?"
          message={`Você está prestes a excluir o perfil "${profileToDelete.name}".\n\nOs favoritos salvos localmente para esse perfil também serão removidos.\n\nEssa ação não poderá ser desfeita.`}
          confirmLabel="Excluir"
          destructive
          onConfirm={handleConfirmDelete}
          onCancel={() => setProfileToDelete(null)}
        />
      )}
    </div>
  )
}

