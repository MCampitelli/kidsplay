import { useCallback, useEffect, useState, type FormEvent } from "react"
import { ApiError, familyApi, type ProfileSummary, type Suggestion } from "../api"
import { LoadingBlock, Notice, TopBar } from "../components"
import { historyGroup } from "../format"
import type { ViewProps } from "../ParentsApp"

const STATUS: Record<Suggestion["status"], { label: string; className: string }> = {
  pending: { label: "Aguardando", className: "bg-[#fff4cc] text-[#8a6d00]" },
  added: { label: "Adicionado", className: "bg-[#e3f7ee] text-[#1b8a62]" },
  declined: { label: "Não será adicionado", className: "bg-[#ffe8e8] text-[#c93a3a]" },
}

export function SuggestionsView({ goBack, onUnauthorized }: ViewProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [titleName, setTitleName] = useState("")
  const [note, setNote] = useState("")
  const [profileId, setProfileId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const handleError = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) return onUnauthorized()
    setError(caught instanceof Error ? caught.message : "Não foi possível carregar.")
  }, [onUnauthorized])

  useEffect(() => {
    familyApi.suggestions().then(setSuggestions).catch(handleError)
    familyApi.overview().then((data) => setProfiles(data.profiles)).catch(() => undefined)
  }, [handleError])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSent(false)
    try {
      setSuggestions(await familyApi.suggest({ titleName: titleName.trim(), note: note.trim() || undefined, profileId }))
      setTitleName("")
      setNote("")
      setSent(true)
    } catch (caught) {
      handleError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh">
      <TopBar title="Sugerir desenho" onBack={() => goBack({ name: "home" })} />
      <main className="safe-bottom mx-auto flex max-w-2xl flex-col gap-4 px-4 pt-5">
        <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
          <p className="font-semibold text-muted">Sentiu falta de algum desenho? Envie a sugestão e acompanhe a resposta aqui.</p>
          <label htmlFor="suggestion-title" className="font-extrabold">Nome do desenho</label>
          <input
            id="suggestion-title"
            required
            maxLength={160}
            value={titleName}
            onChange={(event) => setTitleName(event.target.value)}
            className="field"
            placeholder="Ex.: Bluey"
          />
          {profiles.length > 0 && (
            <>
              <span className="font-extrabold">Para quem?</span>
              <div className="flex flex-wrap gap-2">
                {[{ id: null as number | null, name: "Todos" }, ...profiles].map((profile) => (
                  <button
                    key={profile.id ?? "all"}
                    type="button"
                    aria-pressed={profileId === profile.id}
                    onClick={() => setProfileId(profile.id)}
                    className={`min-h-10 rounded-full px-4 font-extrabold ${profileId === profile.id ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}
                  >
                    {profile.name}
                  </button>
                ))}
              </div>
            </>
          )}
          <label htmlFor="suggestion-note" className="font-extrabold">Comentário <span className="font-semibold text-muted">(opcional)</span></label>
          <textarea
            id="suggestion-note"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="field resize-none"
            placeholder="Ex.: temporada 1, dublado"
          />
          {error && <Notice>{error}</Notice>}
          {sent && <Notice tone="success">Sugestão enviada! Você será avisado aqui quando houver resposta.</Notice>}
          <button type="submit" disabled={busy || !titleName.trim()} className="btn btn-sun w-full text-lg">
            Enviar sugestão
          </button>
        </form>

        <h2 className="px-1 text-sm font-extrabold uppercase tracking-wider text-muted">Minhas sugestões</h2>
        {!suggestions ? (
          <LoadingBlock />
        ) : suggestions.length === 0 ? (
          <p className="px-1 font-semibold text-muted">Nenhuma sugestão enviada ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-extrabold">{suggestion.titleName}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${STATUS[suggestion.status].className}`}>
                    {STATUS[suggestion.status].label}
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-muted">
                  {historyGroup(suggestion.createdAt)}
                  {suggestion.profileName ? ` · para ${suggestion.profileName}` : ""}
                </p>
                {suggestion.note && <p className="mt-2 text-sm font-semibold">{suggestion.note}</p>}
                {suggestion.adminNote && (
                  <p className="mt-2 rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">Resposta: {suggestion.adminNote}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
