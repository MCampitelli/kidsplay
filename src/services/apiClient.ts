const configuredBase = (import.meta.env.KIDSPLAY_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "")
if (configuredBase) {
  const url = new URL(configuredBase)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("KIDSPLAY_PUBLIC_API_BASE_URL deve conter somente uma origem HTTP(S).")
  }
}

export function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(`${configuredBase}${path}`, { ...options, credentials: "include" })
}
