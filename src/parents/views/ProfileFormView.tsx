import { useEffect, useState, type FormEvent } from "react"
import { profileService } from "../../services/profileService"
import { PROFILE_STICKERS, type ProfileStickerId } from "../../types/profile"
import { LoadingBlock, Notice, TopBar } from "../components"
import type { ViewProps } from "../ParentsApp"

/** Criar ou editar o perfil de uma crianca (nome e figurinha); excluir e definitivo. */
export function ProfileFormView({ profileId, navigate, goBack, onUnauthorized }: ViewProps & { profileId: number | null }) {
  const isEdit = profileId !== null
  const [name, setName] = useState("")
  const [avatar, setAvatar] = useState<ProfileStickerId>("teddy")
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (profileId === null) return
    profileService
      .getProfile(profileId)
      .then((profile) => {
        if (!profile) {
          setError("Perfil não encontrado.")
          return
        }
        setName(profile.name)
        if (profile.avatar) setAvatar(profile.avatar)
      })
      .catch((caught: unknown) => {
        if (caught instanceof Error && /autenticad/i.test(caught.message)) onUnauthorized()
        else setError(caught instanceof Error ? caught.message : "Não foi possível carregar.")
      })
      .finally(() => setLoading(false))
  }, [profileId, onUnauthorized])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      if (profileId === null) {
        const created = await profileService.createProfile({ name, avatar })
        navigate({ name: "profile", id: created.id })
      } else {
        await profileService.updateProfile(profileId, { name, avatar })
        goBack({ name: "profile", id: profileId })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (profileId === null) return
    setBusy(true)
    setError("")
    try {
      await profileService.deleteProfile(profileId)
      window.history.replaceState({ depth: 0 }, "", "#/")
      navigate({ name: "home" })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível excluir.")
      setBusy(false)
    }
  }

  const back = () => goBack(isEdit ? { name: "profile", id: profileId } : { name: "home" })

  return (
    <div className="min-h-dvh">
      <TopBar title={isEdit ? "Editar perfil" : "Novo perfil"} onBack={back} />
      <main className="safe-bottom mx-auto max-w-2xl px-4 pt-5">
        {loading ? (
          <LoadingBlock />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="card flex flex-col gap-2 p-5">
              <label htmlFor="profile-name" className="font-extrabold">Nome da criança</label>
              <input
                id="profile-name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="field"
                autoComplete="off"
              />
            </div>

            <fieldset className="card p-5">
              <legend className="float-left mb-3 w-full font-extrabold">Figurinha</legend>
              <div className="grid grid-cols-4 gap-3">
                {PROFILE_STICKERS.map((sticker) => (
                  <button
                    key={sticker.id}
                    type="button"
                    onClick={() => setAvatar(sticker.id)}
                    aria-pressed={avatar === sticker.id}
                    aria-label={sticker.label}
                    className={`flex aspect-square items-center justify-center rounded-2xl text-4xl transition-all ${
                      avatar === sticker.id ? "bg-sun ring-4 ring-brand" : "bg-brand-soft"
                    }`}
                  >
                    {sticker.emoji}
                  </button>
                ))}
              </div>
            </fieldset>

            {error && <Notice>{error}</Notice>}

            <button type="submit" disabled={busy || !name.trim()} className="btn btn-primary w-full text-lg">
              {isEdit ? "Salvar" : "Criar perfil"}
            </button>

            {isEdit && (
              <div className="card mt-2 flex flex-col gap-3 p-5">
                {!confirmDelete ? (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-danger w-full">
                    Excluir perfil
                  </button>
                ) : (
                  <>
                    <p className="font-bold">
                      Excluir o perfil de {name}? O histórico, o tempo de tela e os bloqueios dele também são apagados. Não dá para desfazer.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-ghost flex-1">Cancelar</button>
                      <button type="button" disabled={busy} onClick={() => void remove()} className="btn flex-1 bg-coral text-white">Excluir</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </form>
        )}
      </main>
    </div>
  )
}
