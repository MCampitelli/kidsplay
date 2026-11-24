import { useEffect, useState } from "react"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * "Salvar na tela inicial": no Android/Chrome usa o convite nativo de instalacao;
 * no iPhone/iPad (Safari nao tem convite) mostra o passo a passo.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(
    () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
  )

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

  return {
    installed,
    canPrompt: Boolean(deferred),
    showIosHelp: !installed && !deferred && isIos,
    async install() {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice.catch(() => undefined)
      setDeferred(null)
    },
  }
}
