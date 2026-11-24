// Service worker da Area dos Pais: permite instalar na tela inicial.
// Os dados (API) sempre vem da rede; so a casca do app fica em cache para abrir
// rapido e mostrar algo mesmo com a conexao instavel.
const CACHE = 'kidsplay-pais-v1'
const SHELL = ['/pais/', '/pais/manifest.webmanifest', '/pais/icon-192.png', '/pais/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  // Rede primeiro (sempre a versao mais nova); cache so como reserva offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && url.pathname.startsWith('/pais/')) {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/pais/'))),
  )
})
