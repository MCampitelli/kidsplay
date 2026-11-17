import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnvironment } from '../config/environment.mjs'
import { validateAdminApiOrigin, validateAdminRequestPayload } from './apiPolicy.mjs'

const appId = 'com.kidsplay.admin'
const appLock = app.requestSingleInstanceLock()
let window
let adminSession
let shuttingDown = false
const appRoot = app.getAppPath()
const indexPath = path.join(appRoot, 'catalog-admin', 'index.html')

function logPath() {
  return path.join(app.getPath('userData'), 'logs', 'main.log')
}

async function log(message) {
  try {
    const directory = path.dirname(logPath())
    await mkdir(directory, { recursive: true })
    await appendFile(logPath(), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    console.error('[KidsPlay Admin] Falha ao gravar o log local.')
  }
}

function configPath() {
  return path.join(app.getPath('userData'), 'backend.json')
}

async function backendConfig() {
  const environment = loadEnvironment(app.isPackaged ? 'production' : 'development', app.getAppPath())
  const environmentUrl = environment.KIDSPLAY_ADMIN_API_URL?.trim()
  if (environmentUrl) return validateAdminApiOrigin(environmentUrl, { production: app.isPackaged })
  try {
    const saved = JSON.parse(await readFile(configPath(), 'utf8'))
    return validateAdminApiOrigin(saved.apiBaseUrl, { production: app.isPackaged })
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      await log('Configuração da API inválida no perfil local do aplicativo.')
      return null
    }
    throw error
  }
}

function isTrustedRenderer(event) {
  return window && !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === pathToFileURL(indexPath).href
}

function registerIpcHandlers() {
  ipcMain.handle('kidsplay-admin:get-backend', async event => {
    if (!isTrustedRenderer(event)) return { apiBaseUrl: null }
    try { return { apiBaseUrl: await backendConfig() } } catch (error) {
      await log(`Configuração da API inválida: ${error.message}`)
      return { apiBaseUrl: null }
    }
  })

  ipcMain.handle('kidsplay-admin:set-backend', async (event, candidate) => {
    if (!isTrustedRenderer(event)) return { ok: false, error: 'Solicitação não autorizada.' }
    try {
      const apiBaseUrl = validateAdminApiOrigin(candidate, { production: app.isPackaged })
      if (loadEnvironment(app.isPackaged ? 'production' : 'development', app.getAppPath()).KIDSPLAY_ADMIN_API_URL) {
        return { ok: false, error: 'O endereço da API é controlado pela configuração do ambiente.' }
      }
      await adminSession.clearStorageData({ storages: ['cookies'] })
      const directory = app.getPath('userData')
      await mkdir(directory, { recursive: true })
      const temporaryPath = `${configPath()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify({ apiBaseUrl }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, configPath())
      return { ok: true, apiBaseUrl }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Não foi possível salvar a configuração.' }
    }
  })

  ipcMain.handle('kidsplay-admin:request', async (event, payload) => {
    if (!isTrustedRenderer(event)) return { ok: false, status: 403, error: 'Solicitação não autorizada.' }
    let request
    let baseUrl
    try {
      request = validateAdminRequestPayload(payload)
      baseUrl = await backendConfig()
    } catch (error) {
      await log(`Requisição local rejeitada: ${error instanceof Error ? error.message : 'payload inválido'}`)
      return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Requisição inválida.' }
    }
    if (!baseUrl) return { ok: false, status: 0, error: 'Configure o endereço HTTPS da API do KidsPlay Admin.' }

    try {
      const response = await adminSession.fetch(new URL(request.path, `${baseUrl}/`).href, {
        method: request.method,
        headers: request.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: request.body,
        credentials: 'include',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      const responseText = response.status === 204 ? '' : await response.text()
      if (Buffer.byteLength(responseText, 'utf8') > 8_000_000) {
        await log(`Resposta da API excedeu o limite (HTTP ${response.status}).`)
        return { ok: false, status: 502, error: 'A resposta do backend excedeu o limite permitido.' }
      }
      let data = null
      if (responseText) {
        try { data = JSON.parse(responseText) } catch {
          await log(`A API retornou uma resposta não JSON (HTTP ${response.status}).`)
          return { ok: false, status: 502, error: 'O backend retornou uma resposta inesperada.' }
        }
      }
      if (!response.ok) {
        const error = response.status === 401
          ? 'Sessão encerrada. Entre novamente.'
          : response.status === 403
            ? 'A conta autenticada não tem autorização administrativa.'
            : typeof data?.error === 'string' ? data.error : `Falha de comunicação com o backend (HTTP ${response.status}).`
        return { ok: false, status: response.status, error, data }
      }
      return { ok: true, status: response.status, data }
    } catch (error) {
      await log(`Falha de comunicação com a API (${error.name || 'erro de rede'}).`)
      return {
        ok: false,
        status: 0,
        error: 'Não foi possível conectar à API. Confira o endereço, a rede e se o backend está em execução.',
      }
    }
  })
}

async function createWindow() {
  adminSession = session.fromPartition('persist:kidsplay-admin')
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f7f4',
    webPreferences: {
      preload: path.join(appRoot, 'electron', 'preload.cjs'),
      session: adminSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== pathToFileURL(indexPath).href) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => {
    void log(`Renderer encerrado (${details.reason}, código ${details.exitCode}).`)
    if (!shuttingDown) dialog.showErrorBox('KidsPlay Admin', 'A interface encontrou um erro. Reinicie o aplicativo; os detalhes técnicos estão no log local.')
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = undefined })
  await window.loadFile(indexPath)
}

if (!appLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId(appId)
    registerIpcHandlers()
    await createWindow()
    if (process.argv.includes('--smoke-test')) {
      try {
        const smokeEmail = process.env.KIDSPLAY_ELECTRON_SMOKE_EMAIL
        const smokePassword = process.env.KIDSPLAY_ELECTRON_SMOKE_PASSWORD
        if (Boolean(smokeEmail) !== Boolean(smokePassword)) throw new Error('Credenciais incompletas para o smoke test.')
        const expectedRole = process.env.KIDSPLAY_ELECTRON_SMOKE_EXPECT_ROLE || 'admin'
        if (!['admin', 'user'].includes(expectedRole)) throw new Error('Papel inválido para o smoke test.')
        const expectApiOffline = process.env.KIDSPLAY_ELECTRON_SMOKE_EXPECT_API_OFFLINE === 'true'
        const setBackendUrl = process.env.KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL || ''
        const setBackendUrlAgain = process.env.KIDSPLAY_ELECTRON_SMOKE_SET_BACKEND_URL_AGAIN || ''
        const expectedBackendUrl = process.env.KIDSPLAY_ELECTRON_SMOKE_EXPECT_BACKEND_URL || ''
        const expectRedirectRejected = process.env.KIDSPLAY_ELECTRON_SMOKE_EXPECT_REDIRECT_REJECTED === 'true'
        const mutationSlug = process.env.KIDSPLAY_ELECTRON_SMOKE_MUTATION_SLUG || ''
        const smokeInput = JSON.stringify({
          email: smokeEmail || '',
          password: smokePassword || '',
          expectedRole,
          hasCredentials: Boolean(smokeEmail),
          expectApiOffline,
          setBackendUrl,
          setBackendUrlAgain,
          expectedBackendUrl,
          expectRedirectRejected,
          mutationSlug,
        })
        const result = await window.webContents.executeJavaScript(`(async ({ email, password, expectedRole, hasCredentials, expectApiOffline, setBackendUrl, setBackendUrlAgain, expectedBackendUrl, expectRedirectRejected, mutationSlug }) => {
          if (!window.kidsPlayAdmin || typeof window.kidsPlayAdmin.request !== 'function') {
            throw new Error('Preload bridge unavailable.')
          }
          if (document.querySelector('h1')?.textContent !== 'KidsPlay Admin' ||
              document.documentElement.dataset.kidsPlayAdminLoaded !== 'true' ||
              ![...document.styleSheets].some(sheet => new URL(sheet.href).pathname.endsWith('/styles.css'))) {
            throw new Error('A interface ou seus recursos locais não carregaram corretamente.')
          }
          if (setBackendUrl) {
            const saved = await window.kidsPlayAdmin.setBackend(setBackendUrl)
            if (!saved.ok || saved.apiBaseUrl !== setBackendUrl) throw new Error(saved.error || 'Não foi possível salvar a origem de teste.')
            if (setBackendUrlAgain) {
              const replaced = await window.kidsPlayAdmin.setBackend(setBackendUrlAgain)
              if (!replaced.ok || replaced.apiBaseUrl !== setBackendUrlAgain) throw new Error(replaced.error || 'Não foi possível substituir a origem de teste.')
            }
            const persisted = await window.kidsPlayAdmin.getBackend()
            const expected = setBackendUrlAgain || setBackendUrl
            if (persisted.apiBaseUrl !== expected) throw new Error('A origem não foi recuperada após salvar.')
            return 'backend-config-persisted'
          }
          const backend = await window.kidsPlayAdmin.getBackend()
          if (expectedBackendUrl && backend.apiBaseUrl !== expectedBackendUrl) {
            throw new Error('A origem salva não persistiu após reiniciar o aplicativo (' + (backend.apiBaseUrl || 'vazia') + ').')
          }
          if (expectedBackendUrl) return 'backend-config-restored'
          if (expectRedirectRejected) {
            const login = await window.kidsPlayAdmin.request({
              path: '/api/auth/login',
              method: 'POST',
              body: JSON.stringify({ email, password }),
            })
            if (!login.ok || login.data.user.role !== 'admin') throw new Error('Não foi possível estabelecer a sessão para testar o redirecionamento.')
            const redirect = await window.kidsPlayAdmin.request({ path: '/api/health', method: 'GET' })
            if (redirect.status !== 0 || !redirect.error.includes('Não foi possível conectar')) {
              throw new Error('A resposta de redirecionamento não foi recusada.')
            }
            return 'redirect-rejected'
          }
          if (!backend.apiBaseUrl && expectApiOffline) throw new Error('Uma origem foi exigida para o teste de indisponibilidade.')
          if (!backend.apiBaseUrl) return 'renderer-and-preload-ready'
          if (expectApiOffline) {
            const unavailable = await window.kidsPlayAdmin.request({ path: '/api/health', method: 'GET' })
            if (unavailable.status !== 0 || !unavailable.error.includes('Não foi possível conectar')) {
              throw new Error('A falha de conexão não foi tratada como indisponibilidade da API.')
            }
            return 'api-unavailable-handled'
          }
          const health = await window.kidsPlayAdmin.request({ path: '/api/health', method: 'GET' })
          if (!health.ok || health.data.status !== 'ok') throw new Error(health.error || 'Backend health check failed.')
          let session
          if (hasCredentials) {
            const login = await window.kidsPlayAdmin.request({
              path: '/api/auth/login',
              method: 'POST',
              body: JSON.stringify({ email, password }),
            })
            if (!login.ok) throw new Error(login.error || 'Login do smoke test falhou.')
            if (login.data.user.role !== expectedRole) throw new Error('O papel da conta de smoke test não corresponde ao esperado.')
            session = await window.kidsPlayAdmin.request({ path: '/api/auth/session', method: 'GET' })
          } else {
            session = await window.kidsPlayAdmin.request({ path: '/api/auth/session', method: 'GET' })
          }
          if (session.status === 401) return 'backend-ready-login-required'
          if (!session.ok) throw new Error(session.error || 'Falha ao consultar a sessão do smoke test.')
          if (session.data.user.role !== 'admin') {
            const forbidden = await window.kidsPlayAdmin.request({ path: '/api/status', method: 'GET' })
            if (forbidden.status !== 403) throw new Error('A API não rejeitou a conta sem privilégio administrativo.')
            const logout = await window.kidsPlayAdmin.request({ path: '/api/auth/logout', method: 'POST', body: '{}' })
            if (!logout.ok) throw new Error(logout.error || 'Logout da conta sem privilégio falhou.')
            const afterLogout = await window.kidsPlayAdmin.request({ path: '/api/auth/session', method: 'GET' })
            if (afterLogout.status !== 401) throw new Error('Logout não revogou a sessão sem privilégio.')
            return 'non-admin-rejected'
          }
          if (hasCredentials && expectedRole !== 'admin') throw new Error('A API aceitou a conta sem privilégio administrativo.')
          const status = await window.kidsPlayAdmin.request({ path: '/api/status', method: 'GET' })
          const catalog = await window.kidsPlayAdmin.request({ path: '/api/catalog', method: 'GET' })
          const tags = await window.kidsPlayAdmin.request({ path: '/api/catalog/tags', method: 'GET' })
          const jobs = await window.kidsPlayAdmin.request({ path: '/api/media-processing/jobs', method: 'GET' })
          if (!status.ok || !catalog.ok || !tags.ok || !jobs.ok ||
              !Array.isArray(catalog.data) || !Array.isArray(tags.data) || !Array.isArray(jobs.data.jobs)) {
            throw new Error('Admin catalog API smoke check failed.')
          }
          if (mutationSlug) {
            const call = (path, method, body) => window.kidsPlayAdmin.request({
              path,
              method,
              body: JSON.stringify(body),
            })
            const tag = await call('/api/catalog/tags', 'POST', {
              name: mutationSlug,
              description: 'fixture Electron',
              displayOrder: 91,
              isActive: true,
            })
            if (!tag.ok || tag.status !== 201) throw new Error(tag.error || 'Cadastro de tag via IPC falhou.')
            const tagUpdate = await call('/api/catalog/tags/' + tag.data.id, 'PUT', {
              name: mutationSlug + '-editada',
              description: 'tag atualizada',
              displayOrder: 92,
              isActive: true,
            })
            if (!tagUpdate.ok) throw new Error(tagUpdate.error || 'Edição de tag via IPC falhou.')
            const title = await call('/api/catalog/titles', 'POST', {
              name: 'Título ' + mutationSlug,
              slug: mutationSlug,
              status: 'draft',
              tagIds: [tag.data.id],
            })
            if (!title.ok || title.status !== 201) throw new Error(title.error || 'Cadastro de título via IPC falhou.')
            const titleUpdate = await call('/api/catalog/titles/' + title.data.id, 'PUT', {
              name: 'Título editado ' + mutationSlug,
              slug: mutationSlug,
              status: 'draft',
              tagIds: [tag.data.id],
            })
            if (!titleUpdate.ok) throw new Error(titleUpdate.error || 'Edição de título via IPC falhou.')
            const season = await call('/api/catalog/seasons', 'POST', {
              titleId: title.data.id,
              number: 1,
              name: 'Temporada teste',
              status: 'draft',
            })
            if (!season.ok || season.status !== 201) throw new Error(season.error || 'Cadastro de temporada via IPC falhou.')
            const seasonUpdate = await call('/api/catalog/seasons/' + season.data.id, 'PUT', {
              titleId: title.data.id,
              number: 1,
              name: 'Temporada editada',
              status: 'draft',
            })
            if (!seasonUpdate.ok) throw new Error(seasonUpdate.error || 'Edição de temporada via IPC falhou.')
            const episode = await call('/api/catalog/episodes', 'POST', {
              seasonId: season.data.id,
              number: 1,
              name: 'Episódio teste',
              durationSeconds: 60,
              status: 'draft',
            })
            if (!episode.ok || episode.status !== 201) throw new Error(episode.error || 'Cadastro de episódio via IPC falhou.')
            const episodeUpdate = await call('/api/catalog/episodes/' + episode.data.id, 'PUT', {
              seasonId: season.data.id,
              number: 1,
              name: 'Episódio editado',
              durationSeconds: 90,
              status: 'draft',
            })
            if (!episodeUpdate.ok) throw new Error(episodeUpdate.error || 'Edição de episódio via IPC falhou.')
            const account = await call('/api/accounts', 'POST', {
              name: 'Conta teste Electron',
              email: mutationSlug + '@example.test',
              password: 'Only-a-temporary-test-password-2026',
              status: 'active',
            })
            if (!account.ok || account.status !== 201) throw new Error(account.error || 'Cadastro de conta via IPC falhou.')
            const accountUpdate = await call('/api/accounts/' + account.data.id, 'PUT', {
              name: 'Conta editada Electron',
              email: mutationSlug + '@example.test',
              status: 'suspended',
            })
            if (!accountUpdate.ok) throw new Error(accountUpdate.error || 'Edição de conta via IPC falhou.')
            const refreshedCatalog = await window.kidsPlayAdmin.request({ path: '/api/catalog', method: 'GET' })
            const refreshedTags = await window.kidsPlayAdmin.request({ path: '/api/catalog/tags', method: 'GET' })
            const refreshedAccounts = await window.kidsPlayAdmin.request({ path: '/api/accounts', method: 'GET' })
            if (!refreshedCatalog.ok || !refreshedCatalog.data.some(item => item.id === title.data.id) ||
                !refreshedTags.ok || !refreshedTags.data.some(item => item.id === tag.data.id) ||
                !refreshedAccounts.ok || !refreshedAccounts.data.some(item => item.id === account.data.id)) {
              throw new Error('A consulta após escrita via IPC não encontrou as fixtures.')
            }
          }
          const logout = await window.kidsPlayAdmin.request({ path: '/api/auth/logout', method: 'POST', body: '{}' })
          if (!logout.ok) throw new Error(logout.error || 'Logout failed.')
          const afterLogout = await window.kidsPlayAdmin.request({ path: '/api/auth/session', method: 'GET' })
          if (afterLogout.status !== 401) throw new Error('Logout did not revoke the session.')
          return mutationSlug ? 'admin-api-session-and-crud-ready' : 'admin-api-and-session-ready'
        })(${smokeInput})`)
        process.stdout.write(`KIDSPLAY_ELECTRON_READY ${result}\n`)
      } catch (error) {
        await log(`Electron smoke test failed (${error.name || 'erro'}).`)
        process.stderr.write(`KidsPlay Admin smoke test failed: ${error.message || 'erro inesperado'}\n`)
        process.exitCode = 1
      } finally {
        app.quit()
      }
      return
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  }).catch(async error => {
    await log(`Falha ao iniciar o aplicativo (${error.name || 'erro'}).`)
    dialog.showErrorBox('KidsPlay Admin', 'Não foi possível iniciar o aplicativo. Consulte o log local.')
    app.quit()
  })

  app.on('before-quit', () => { shuttingDown = true })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
