import { useRef, useState, type FormEvent } from "react"
import { PROFILE_STICKERS, type Profile, type ProfileStickerId } from "../types/profile"

export function ProfileFormDialog({
  mode,
  initialProfile,
  existingNames,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit"
  initialProfile?: Profile | null
  existingNames: string[]
  onCancel: () => void
  onSubmit: (name: string, avatar: ProfileStickerId) => Promise<void>
}) {
  const [name, setName] = useState(initialProfile?.name ?? "")
  const [avatar, setAvatar] = useState<ProfileStickerId>(initialProfile?.avatar ?? "teddy")
  const selectedStickerIndex = Math.max(0, PROFILE_STICKERS.findIndex((sticker) => sticker.id === avatar))
  const [error, setError] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const stickerRefs = useRef<Array<HTMLButtonElement | null>>([])
  const cancelRef = useRef<HTMLButtonElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  // Remote controls have no Tab key: ArrowDown leaves the input, ArrowLeft/Right swaps buttons.
  function focusSibling(target: React.RefObject<HTMLButtonElement | null>) {
    return (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        target.current?.focus()
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        stickerRefs.current[selectedStickerIndex]?.focus()
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()

    if (!trimmedName) {
      setError("Informe o nome do perfil.")
      return
    }

    const normalizedExistingNames = existingNames
      .filter((existingName) => existingName !== initialProfile?.name)
      .map((existingName) => existingName.trim().toLowerCase())
    if (normalizedExistingNames.includes(trimmedName.toLowerCase())) {
      setError("Já existe um perfil com esse nome.")
      return
    }

    setError("")
    setIsSaving(true)
    try {
      await onSubmit(trimmedName, avatar)
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível salvar o perfil.",
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl"
      >
        <h2 className="font-display text-2xl text-[#2D2D2D] text-center mb-6">
          {mode === "create" ? "Novo perfil" : "Editar perfil"}
        </h2>
        <label className="block text-sm font-bold text-[#2D2D2D] mb-2">
          Nome do perfil
        </label>
        <input
          ref={nameRef}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              stickerRefs.current[0]?.focus()
            }
          }}
          placeholder="Ex: Criança 1"
          aria-label="Nome do perfil"
          className="w-full rounded-2xl border-2 border-[#FFD93D] bg-[#FFF8F0] px-4 py-3 outline-none"
        />
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-bold text-[#2D2D2D]">Figurinha</legend>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Figurinha do perfil">
            {PROFILE_STICKERS.map((sticker, index) => (
              <button
                key={sticker.id}
                ref={(element) => { stickerRefs.current[index] = element }}
                type="button"
                aria-label={sticker.label}
                aria-pressed={avatar === sticker.id}
                onClick={() => setAvatar(sticker.id)}
                onFocus={() => setAvatar(sticker.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    submitRef.current?.focus()
                    return
                  }
                  const columnCount = 4
                  const nextIndex = {
                    ArrowLeft: index % columnCount > 0 ? index - 1 : index,
                    ArrowRight: index % columnCount < columnCount - 1 ? index + 1 : index,
                    ArrowUp: index >= columnCount ? index - columnCount : -1,
                    ArrowDown: index + columnCount < PROFILE_STICKERS.length ? index + columnCount : -2,
                  }[event.key]
                  if (nextIndex === undefined) return
                  event.preventDefault()
                  if (nextIndex === -1) nameRef.current?.focus()
                  else if (nextIndex === -2) cancelRef.current?.focus()
                  else stickerRefs.current[nextIndex]?.focus()
                }}
                data-tv-focusable
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 transition-colors ${
                  avatar === sticker.id
                    ? "border-[#FF6B6B] bg-[#FFF0E8]"
                    : "border-[#E5E5E5] bg-white hover:border-[#FFD93D]"
                }`}
              >
                <span className="text-3xl leading-none" aria-hidden="true">{sticker.emoji}</span>
                <span className="text-xs font-bold text-[#454545]">{sticker.label}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="mt-3 text-center text-sm font-bold text-[#FF6B6B]">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            onKeyDown={focusSibling(submitRef)}
            disabled={isSaving}
            className="flex-1 rounded-full bg-[#FFF8F0] px-4 py-3 font-bold text-[#2D2D2D] border-2 border-[#FFD93D] transition-colors hover:bg-[#FFE8D1] disabled:opacity-50"
            data-tv-focusable
          >
            Cancelar
          </button>
          <button
            ref={submitRef}
            type="submit"
            onKeyDown={focusSibling(cancelRef)}
            disabled={isSaving}
            className="flex-1 rounded-full bg-[#FF6B6B] px-4 py-3 font-bold text-white transition-colors hover:bg-[#e85555] disabled:opacity-50"
            data-tv-focusable
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  )
}
