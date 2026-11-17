const state = {
  catalog: [],
  tags: [],
  accounts: [],
  tab: 'accounts',
  titleId: null,
  seasonId: null,
  episodeId: null,
  jobs: [],
  workerAvailable: false,
  clearMediaPathEpisodeId: null,
  edit: { account: 'new', title: 'new', tag: 'new', season: null, episode: null, asset: null },
  slugTouched: false,
}

const workspace = document.querySelector('#workspace')
const notice = document.querySelector('#notice')
const statusLine = document.querySelector('#connection-state')
const databaseName = document.querySelector('#database-name')

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function api(path, options = {}) {
  if (window.kidsPlayAdmin) {
    const result = await window.kidsPlayAdmin.request({
      path,
      method: options.method || 'GET',
      body: options.body,
    })
    if (!result.ok) {
      if (result.status === 401) showLogin(result.error)
      const error = new Error(result.error || `Falha HTTP ${result.status}.`)
      error.status = result.status
      throw error
    }
    return result.data
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const body = response.status === 204 ? {} : await response.json()
  if (!response.ok) {
    if (response.status === 401) showLogin()
    throw new Error(body.error || `Falha HTTP ${response.status}.`)
  }
  return body
}

function showNotice(message, kind = 'success') {
  notice.textContent = message
  notice.className = `notice ${kind === 'error' ? 'is-error' : 'is-success'}`
  notice.hidden = !message
}

function showConnection(connected, label) {
  statusLine.classList.toggle('is-connected', connected)
  statusLine.classList.toggle('is-error', !connected)
  statusLine.querySelector('span').textContent = label
}

function titleById(id) {
  return state.catalog.find((item) => item.id === Number(id)) || null
}

function seasonById(id) {
  for (const title of state.catalog) {
    const season = title.seasons.find((item) => item.id === Number(id))
    if (season) return season
  }
  return null
}

function episodeById(id) {
  for (const title of state.catalog) {
    for (const season of title.seasons) {
      const episode = season.episodes.find((item) => item.id === Number(id))
      if (episode) return { title, season, episode }
    }
  }
  return null
}

function statusSelect(current = 'draft') {
  return `<select name="status" required>
    <option value="draft" ${current === 'draft' ? 'selected' : ''}>Rascunho</option>
    <option value="published" ${current === 'published' ? 'selected' : ''}>Publicado</option>
    <option value="archived" ${current === 'archived' ? 'selected' : ''}>Arquivado</option>
  </select>`
}

function titleOptions(selectedId) {
  if (!state.catalog.length) return '<option value="">Cadastre um título primeiro</option>'
  return state.catalog.map((title) => `<option value="${title.id}" ${title.id === Number(selectedId) ? 'selected' : ''}>${escapeHtml(title.name)}</option>`).join('')
}

function seasonOptions(title, selectedId) {
  if (!title?.seasons.length) return '<option value="">Cadastre uma temporada primeiro</option>'
  return title.seasons.map((season) => `<option value="${season.id}" ${season.id === Number(selectedId) ? 'selected' : ''}>T${season.number} · ${escapeHtml(season.name || `Temporada ${season.number}`)}</option>`).join('')
}

function episodeOptions(season, selectedId) {
  if (!season?.episodes.length) return '<option value="">Cadastre um episódio primeiro</option>'
  return season.episodes.map((episode) => `<option value="${episode.id}" ${episode.id === Number(selectedId) ? 'selected' : ''}>E${episode.number} · ${escapeHtml(episode.name)}</option>`).join('')
}

function recordRow({ id, title, detail, status = '', selected = false, type }) {
  const statusHtml = status ? `<span class="status-label ${status}">${escapeHtml(status)}</span>` : ''
  return `<button class="record-row ${selected ? 'is-selected' : ''}" type="button" data-edit="${type}" data-id="${id}">
    <span class="record-row-main"><span class="record-kicker">${escapeHtml(detail)}</span><strong>${escapeHtml(title)}</strong></span>${statusHtml}
  </button>`
}

function recordList(items, emptyText) {
  return items.length ? `<div class="record-list">${items.join('')}</div>` : `<div class="empty-state">${emptyText}</div>`
}

function editorHeading(title, subtitle, isEditing) {
  const heading = isEditing ? 'Editar' : title === 'conta' ? 'Nova' : 'Novo'
  return `<div class="editor-heading"><div><h2>${heading} ${title}</h2><p>${subtitle}</p></div></div>`
}

function saveButton(label) {
  return `<div class="form-actions"><button class="button button-primary" type="submit">${escapeHtml(label)}</button><button class="button button-quiet" type="button" data-action="new">Novo</button><span class="form-state"></span></div>`
}

function accountStatusSelect(current = 'active') {
  return `<select name="status" required>
    <option value="active" ${current === 'active' ? 'selected' : ''}>Ativa</option>
    <option value="pending" ${current === 'pending' ? 'selected' : ''}>Pendente</option>
    <option value="suspended" ${current === 'suspended' ? 'selected' : ''}>Suspensa</option>
  </select>`
}

function renderAccounts() {
  const selectedId = typeof state.edit.account === 'number' ? state.edit.account : null
  const selected = selectedId ? state.accounts.find((account) => account.id === selectedId) : null
  const isNew = state.edit.account === 'new'
  const items = state.accounts.map((account) => recordRow({
    id: account.id,
    type: 'account',
    title: account.name,
    detail: account.email,
    status: account.status,
    selected: selected?.id === account.id,
  }))
  const form = selected || isNew
    ? `<form data-form="account">
        <div class="inline-note">As contas usam e-mail para entrar. Senhas nunca são exibidas e só ficam armazenadas como hash seguro. Marcar como ativa confirma o e-mail manualmente; este Controle não envia mensagens.</div>
        <div class="form-grid">
          <div class="field full"><label for="account-name">Nome *</label><input id="account-name" name="name" maxlength="160" required autocomplete="name" value="${escapeHtml(selected?.name)}" /></div>
          <div class="field full"><label for="account-email">E-mail *</label><input id="account-email" name="email" type="email" maxlength="254" required autocomplete="email" value="${escapeHtml(selected?.email)}" /></div>
          ${selected ? '<div class="field full"><small>A senha existente não pode ser consultada. O status altera o acesso sem remover a conta.</small></div>' : '<div class="field full"><label for="account-password">Senha inicial *</label><input id="account-password" name="password" type="password" minlength="12" maxlength="1024" required autocomplete="new-password" /><small>Mínimo de 12 caracteres. A senha é enviada apenas ao backend para gerar o hash.</small></div>'}
          <div class="field"><label for="account-status">Acesso</label><select id="account-status" name="status">${accountStatusSelect(selected?.status || 'active').replace('<select name="status" required>', '').replace('</select>', '')}</select></div>
          ${selected ? `<div class="field"><label>Cadastro</label><input readonly value="${selected.emailVerified ? 'E-mail verificado' : 'E-mail não verificado'}" /></div>` : ''}
        </div>${saveButton(selected ? 'Salvar conta' : 'Criar conta')}
      </form>`
    : '<div class="empty-state">Selecione uma conta para alterar nome, e-mail ou status.</div>'

  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Contas</h2><p>${state.accounts.length} usuário(s)</p></div><button class="button button-primary button-small" type="button" data-action="new">+ Nova conta</button></div>${recordList(items, 'Nenhum usuário cadastrado.')}</section>
    <section class="editor-column">${editorHeading('conta', 'Cadastro e controle de acesso.', Boolean(selected))}${form}</section>
  </div>`
}

function renderTitles() {
  const editingId = typeof state.edit.title === 'number' ? state.edit.title : null
  const selected = editingId ? titleById(editingId) : null
  const isNew = state.edit.title === 'new'
  const formValue = selected || {}
  const items = state.catalog.map((title) => recordRow({
    id: title.id,
    type: 'title',
    title: title.name,
    detail: title.slug,
    status: title.status,
    selected: selected?.id === title.id,
  }))
  const form = selected || isNew
    ? `<form data-form="title">
        <div class="form-grid">
          <div class="field full"><label for="title-name">Nome oficial *</label><input id="title-name" name="name" maxlength="255" required value="${escapeHtml(formValue.name)}" /></div>
          <div class="field"><label for="title-slug">Slug único *</label><input id="title-slug" name="slug" maxlength="180" required value="${escapeHtml(formValue.slug)}" /><small>Gerado do nome; você pode personalizar.</small></div>
          <div class="field"><label for="title-year">Ano</label><input id="title-year" name="releaseYear" type="number" min="1" max="65535" value="${formValue.releaseYear ?? ''}" /></div>
          <div class="field"><label for="title-rating">Classificação indicativa</label><input id="title-rating" name="contentRating" maxlength="16" placeholder="Livre, 10, 12..." value="${escapeHtml(formValue.contentRating)}" /></div>
          <div class="field"><label for="title-order">Ordem de exibição</label><input id="title-order" name="displayOrder" type="number" value="${Number(formValue.displayOrder) || 0}" /></div>
          <div class="field full"><label for="title-description">Descrição</label><textarea id="title-description" name="description" maxlength="5000">${escapeHtml(formValue.description)}</textarea></div>
          <div class="field"><label for="title-cover">Caminho da capa</label><input id="title-cover" name="coverPath" maxlength="1024" placeholder="/files/Desenho/capa.jpg" value="${escapeHtml(formValue.coverPath)}" /></div>
          <div class="field"><label for="title-poster">Caminho do pôster</label><input id="title-poster" name="posterPath" maxlength="1024" placeholder="/files/Desenho/poster.jpg" value="${escapeHtml(formValue.posterPath)}" /></div>
          <div class="field"><label for="title-banner">Caminho do banner</label><input id="title-banner" name="bannerPath" maxlength="1024" placeholder="/files/Desenho/banner.jpg" value="${escapeHtml(formValue.bannerPath)}" /></div>
          <div class="field"><label for="title-status">Publicação</label><select id="title-status" name="status">${statusSelect(formValue.status || 'draft').replace('<select name="status" required>', '').replace('</select>', '')}</select></div>
          ${titleTagPicker(formValue.tagIds || [])}
        </div>${saveButton('Salvar título')}
      </form>`
    : `<div class="empty-state">Selecione um título para editar ou use Novo título para cadastrar.</div>`

  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Títulos</h2><p>${state.catalog.length} cadastrado(s)</p></div><button class="button button-primary button-small" type="button" data-action="new">+ Novo título</button></div>${recordList(items, 'Nenhum título cadastrado.')}</section>
    <section class="editor-column">${editorHeading('título', 'Identificação, publicação e imagens.', Boolean(selected))}${form}</section>
  </div>`
}

function titleTagPicker(selectedIds) {
  const options = state.tags.filter((tag) => tag.isActive || selectedIds.includes(tag.id))
  return `<fieldset class="field full tag-picker"><legend>Tags / Categorias</legend>
    <small>Selecione várias tags. Tags desativadas já associadas são preservadas até você removê-las.</small>
    <label for="title-tag-search">Pesquisar tags pelo nome</label>
    <input id="title-tag-search" type="search" data-tag-search="options" placeholder="Buscar tag..." />
    <div class="selected-tags" id="selected-tags" aria-live="polite"></div>
    <div class="tag-options">${options.map((tag) => `<label class="tag-option" data-tag-name="${escapeHtml(slugify(tag.name))}">
      <input type="checkbox" name="tagIds" value="${tag.id}" ${selectedIds.includes(tag.id) ? 'checked' : ''} />
      <span>${escapeHtml(tag.name)}${tag.isActive ? '' : ' (desativada)'}</span>
    </label>`).join('')}</div>
    <small data-tag-empty ${options.length ? 'hidden' : ''}>Nenhuma tag disponível. Cadastre tags ativas na aba Tags / Categorias.</small>
  </fieldset>`
}

function updateSelectedTags() {
  const container = document.querySelector('#selected-tags')
  if (!container) return
  const selected = [...workspace.querySelectorAll('input[name="tagIds"]:checked')]
  container.innerHTML = selected.map((input) => {
    const tag = state.tags.find((item) => item.id === Number(input.value))
    return `<button class="tag-chip" type="button" data-remove-tag="${tag.id}" aria-label="Remover ${escapeHtml(tag.name)}">${escapeHtml(tag.name)}${tag.isActive ? '' : ' (desativada)'} <span aria-hidden="true">×</span></button>`
  }).join('') || '<small>Nenhuma tag selecionada.</small>'
}

function renderTags() {
  const selected = state.tags.find((tag) => tag.id === state.edit.tag)
  const items = state.tags.map((tag) => `<div data-tag-name="${escapeHtml(slugify(tag.name))}">${recordRow({
    id: tag.id, type: 'tag', title: tag.name,
    detail: `${tag.titleCount} título(s) · ordem ${tag.displayOrder} · ${tag.slug}`,
    status: tag.isActive ? 'ativa' : 'desativada', selected: selected?.id === tag.id,
  })}</div>`)
  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Tags / Categorias</h2><p>${state.tags.length} cadastrada(s)</p></div><button class="button button-primary button-small" type="button" data-action="new">+ Nova tag</button></div>
      <div class="field filter-gap"><label for="tag-search">Pesquisar tags</label><input id="tag-search" type="search" data-tag-search="records" placeholder="Nome da tag..." /></div>
      ${recordList(items, 'Nenhuma tag cadastrada.')}<small data-tag-empty hidden>Nenhuma tag encontrada.</small>
    </section>
    <section class="editor-column"><div class="editor-heading"><div><h2>${selected ? 'Editar tag' : 'Nova tag'}</h2><p>Categorias globais; favoritos continuam independentes por perfil.</p></div></div>
      <form data-form="tag"><div class="form-grid">
        <div class="field full"><label for="tag-name">Nome *</label><input id="tag-name" name="name" maxlength="100" required value="${escapeHtml(selected?.name)}" /></div>
        <div class="field full"><label for="tag-slug">Slug automático</label><input id="tag-slug" readonly value="${escapeHtml(selected?.slug)}" /><small>Gerado do nome; deve ser único.</small></div>
        <div class="field full"><label for="tag-description">Descrição</label><textarea id="tag-description" name="description" maxlength="255">${escapeHtml(selected?.description)}</textarea></div>
        <div class="field"><label for="tag-order">Ordem de exibição</label><input id="tag-order" name="displayOrder" type="number" min="-2147483648" max="2147483647" step="1" required value="${selected?.displayOrder ?? 0}" /></div>
        <div class="field"><label for="tag-active">Disponibilidade</label><select id="tag-active" name="isActive"><option value="true" ${selected?.isActive !== false ? 'selected' : ''}>Ativa</option><option value="false" ${selected?.isActive === false ? 'selected' : ''}>Desativada</option></select></div>
      </div>${saveButton(selected ? 'Salvar tag' : 'Criar tag')}</form>
    </section>
  </div>`
}

function renderSeasons() {
  const selectedTitleId = Number(state.titleId) || Number(state.edit.season ? seasonById(state.edit.season)?.titleId : null) || state.catalog[0]?.id || null
  state.titleId = selectedTitleId
  const title = titleById(selectedTitleId)
  const selected = seasonById(state.edit.season)
  const items = (title?.seasons || []).map((season) => recordRow({
    id: season.id,
    type: 'season',
    title: season.name || `Temporada ${season.number}`,
    detail: `T${season.number} · ${season.episodes.length} episódio(s)`,
    status: season.status,
    selected: selected?.id === season.id,
  }))
  const form = title
    ? `<form data-form="season"><div class="form-grid">
        <div class="field full"><label for="season-title">Título *</label><select id="season-title" name="titleId" data-select="title">${titleOptions(title.id)}</select></div>
        <div class="field"><label for="season-number">Número da temporada *</label><input id="season-number" name="number" type="number" min="1" max="65535" required value="${selected?.number ?? ''}" /></div>
        <div class="field"><label for="season-name">Nome opcional</label><input id="season-name" name="name" maxlength="255" placeholder="Temporada especial" value="${escapeHtml(selected?.name)}" /></div>
        <div class="field full"><label for="season-description">Descrição</label><textarea id="season-description" name="description" maxlength="5000">${escapeHtml(selected?.description)}</textarea></div>
        <div class="field"><label for="season-status">Publicação</label><select id="season-status" name="status">${statusSelect(selected?.status || 'draft').replace('<select name="status" required>', '').replace('</select>', '')}</select></div>
      </div>${saveButton('Salvar temporada')}</form>`
    : '<div class="empty-state">Cadastre ou selecione um título primeiro.</div>'
  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Temporadas</h2><p>${escapeHtml(title?.name || 'Selecione um título')}</p></div><button class="button button-primary button-small" type="button" data-action="new" ${title ? '' : 'disabled'}>+ Nova temporada</button></div>
      <div class="field filter-gap"><label for="season-filter-title">Título selecionado</label><select id="season-filter-title" data-select="title">${titleOptions(title?.id)}</select></div>${recordList(items, 'Nenhuma temporada neste título.')}</section>
    <section class="editor-column">${editorHeading('temporada', 'Temporadas numeradas dentro do título selecionado.', Boolean(selected))}${form}</section>
  </div>`
}

function renderEpisodes() {
  const selectedSeason = seasonById(state.edit.episode ? episodeById(state.edit.episode)?.season.id : state.seasonId)
  const selectedTitleId = Number(state.titleId) || selectedSeason?.titleId || state.catalog[0]?.id || null
  const title = titleById(selectedTitleId)
  const season = title?.seasons.find((item) => item.id === Number(state.seasonId)) || title?.seasons[0] || null
  state.titleId = title?.id || null
  state.seasonId = season?.id || null
  const selected = episodeById(state.edit.episode)?.episode || null
  const items = (season?.episodes || []).map((episode) => recordRow({
    id: episode.id,
    type: 'episode',
    title: episode.name,
    detail: `E${episode.number} · ${formatDuration(episode.durationSeconds)}`,
    status: episode.status,
    selected: selected?.id === episode.id,
  }))
  const form = season
    ? `<form data-form="episode"><div class="form-grid">
        <div class="field"><label for="episode-title">Título *</label><select id="episode-title" name="titleId" data-select="title">${titleOptions(title.id)}</select></div>
        <div class="field"><label for="episode-season">Temporada *</label><select id="episode-season" name="seasonId" data-select="season">${seasonOptions(title, season.id)}</select></div>
        <div class="field"><label for="episode-number">Número *</label><input id="episode-number" name="number" type="number" min="1" max="65535" required value="${selected?.number ?? ''}" /></div>
        <div class="field"><label for="episode-name">Nome *</label><input id="episode-name" name="name" maxlength="255" required value="${escapeHtml(selected?.name)}" /></div>
        <div class="field"><label for="episode-duration">Duração (minutos) *</label><input id="episode-duration" name="durationMinutes" type="number" min="0.1" step="0.1" required value="${selected ? (selected.durationSeconds / 60).toFixed(1) : ''}" /></div>
        <div class="field"><label for="episode-status">Publicação</label><select id="episode-status" name="status">${statusSelect(selected?.status || 'draft').replace('<select name="status" required>', '').replace('</select>', '')}</select></div>
        <div class="field full"><label for="episode-description">Descrição</label><textarea id="episode-description" name="description" maxlength="5000">${escapeHtml(selected?.description)}</textarea></div>
      </div>${saveButton('Salvar episódio')}</form>`
    : '<div class="empty-state">Cadastre uma temporada para começar a incluir episódios.</div>'
  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Episódios</h2><p>${escapeHtml(title?.name || 'Selecione um título')}</p></div><button class="button button-primary button-small" type="button" data-action="new" ${season ? '' : 'disabled'}>+ Novo episódio</button></div>
      <div class="form-grid filter-grid"><div class="field"><label for="episodes-filter-title">Título</label><select id="episodes-filter-title" data-select="title">${titleOptions(title?.id)}</select></div><div class="field"><label for="episodes-filter-season">Temporada</label><select id="episodes-filter-season" data-select="season">${seasonOptions(title, season?.id)}</select></div></div>
      ${recordList(items, 'Nenhum episódio nesta temporada.')}</section>
    <section class="editor-column">${editorHeading('episódio', 'Numeração, duração e publicação.', Boolean(selected))}${form}</section>
  </div>`
}

function renderAssets() {
  const editingAsset = state.edit.asset !== null && typeof state.edit.asset === 'object'
  const edited = editingAsset ? episodeById(state.edit.asset.episodeId) : null
  const titleId = Number(state.titleId) || edited?.title.id || state.catalog[0]?.id || null
  const title = titleById(titleId)
  state.titleId = title?.id || null
  const season = title?.seasons.find((item) => item.id === Number(state.seasonId)) || edited?.season || title?.seasons[0] || null
  state.seasonId = season?.id || null
  const episode = season?.episodes.find((item) => item.id === Number(state.episodeId)) || edited?.episode || season?.episodes[0] || null
  state.episodeId = episode?.id || null
  const asset = editingAsset
    ? episode?.assets.find((item) => `${item.episodeId}:${item.format}:${item.quality}` === state.edit.asset.key) || state.edit.asset
    : null
  const assetRows = (episode?.assets || []).map((item) => `<button class="record-row ${asset === item ? 'is-selected' : ''}" type="button" data-edit="asset" data-id="${item.id}" data-episode="${episode.id}" data-format="${item.format}" data-quality="${escapeHtml(item.quality)}">
    <span class="record-row-main"><span class="record-kicker">${escapeHtml(item.format.toUpperCase())} · ${escapeHtml(item.quality)} · ${item.available ? 'Disponível' : 'Indisponível'}</span><strong>${escapeHtml(item.path)}</strong></span><span class="record-count">${item.sizeBytes ? formatSize(item.sizeBytes) : ''}</span>
  </button>`)
  const mp4Asset = episode?.assets.find((item) => item.format === 'mp4')
  const job = state.jobs.find((item) => item.episodeId === episode?.id)
  const form = episode
    ? `<form data-form="asset"><div class="form-grid">
        <div class="field"><label for="asset-title">Título *</label><select id="asset-title" name="titleId" data-select="title">${titleOptions(title.id)}</select></div>
        <div class="field"><label for="asset-season">Temporada *</label><select id="asset-season" name="seasonId" data-select="season">${seasonOptions(title, season.id)}</select></div>
        <div class="field full"><label for="asset-episode">Episódio *</label><select id="asset-episode" name="episodeId" data-select="episode">${episodeOptions(season, episode.id)}</select></div>
        <div class="field full"><label for="asset-path">Caminho do arquivo MP4 *</label><input id="asset-path" name="path" maxlength="2048" required placeholder="/files/Desenho/Episódio.mp4 ou caminho absoluto no backend" value="${state.clearMediaPathEpisodeId === episode.id ? '' : escapeHtml(mp4Asset?.path)}" /><small>O arquivo precisa existir em files no host do backend que executa o worker. O MP4 é registrado imediatamente; thumbnail e HLS são processados nesse host em segundo plano.</small></div>
      </div>${saveButton('Salvar MP4 e processar')}</form>`
    : '<div class="empty-state">Cadastre um episódio para associar arquivos MP4 ou HLS.</div>'
  workspace.innerHTML = `<div class="workspace-grid">
    <section class="record-column"><div class="section-heading"><div><h2>Arquivos de mídia</h2><p>${escapeHtml(episode ? `E${episode.number} · ${episode.name}` : 'Selecione um episódio')}</p></div><button class="button button-quiet button-small" type="button" data-action="process-pending">Processar pendentes</button></div>
      <div class="form-grid filter-grid"><div class="field"><label for="assets-filter-title">Título</label><select id="assets-filter-title" data-select="title">${titleOptions(title?.id)}</select></div><div class="field"><label for="assets-filter-season">Temporada</label><select id="assets-filter-season" data-select="season">${seasonOptions(title, season?.id)}</select></div><div class="field full"><label for="assets-filter-episode">Episódio</label><select id="assets-filter-episode" data-select="episode">${episodeOptions(season, episode?.id)}</select></div></div>
      ${processingStatus(job, episode?.id)}
      ${recordList(assetRows, 'Nenhum arquivo associado a este episódio.')}</section>
    <section class="editor-column">${editorHeading('arquivo', 'Cadastre o MP4; thumbnail e HLS são preparados automaticamente.', Boolean(mp4Asset))}${form}</section>
  </div>`
}

function processingStatus(job, episodeId) {
  const labels = {
    queued: 'Aguardando processamento',
    thumbnail: 'Gerando thumbnail',
    'verifying-hls': 'Verificando HLS',
    'converting-hls': 'Convertendo HLS',
    'validating-hls': 'Validando HLS',
    completed: 'Concluído',
    error: 'Erro',
  }
  if (!episodeId) return '<div id="processing-status" class="processing-status" aria-live="polite">Selecione um episódio.</div>'
  if (!job) return '<div id="processing-status" class="processing-status" aria-live="polite">A mídia ainda não foi processada.</div>'
  const retry = job.status === 'error'
    ? `<button class="button button-quiet button-small" type="button" data-action="retry-episode" data-episode="${episodeId}">Tentar novamente</button>`
    : ''
  return `<div id="processing-status" class="processing-status ${job.status === 'error' ? 'is-error' : ''}" aria-live="polite"><div><strong>${labels[job.status] || 'Processamento'}</strong><span>${escapeHtml(job.message || '')}</span></div>${retry}</div>`
}

function formatDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60)
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

function formatSize(bytes) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function render() {
  document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === state.tab))
  if (state.tab === 'accounts') renderAccounts()
  if (state.tab === 'titles') renderTitles()
  if (state.tab === 'tags') renderTags()
  if (state.tab === 'seasons') renderSeasons()
  if (state.tab === 'episodes') renderEpisodes()
  if (state.tab === 'assets') renderAssets()
  updateSelectedTags()
}

async function refreshCatalog() {
  const [catalog, tags] = await Promise.all([api('/api/catalog'), api('/api/catalog/tags')])
  state.catalog = catalog
  state.tags = tags
  const stillThere = titleById(state.titleId)
  if (!stillThere) state.titleId = state.catalog[0]?.id || null
  render()
}

async function refreshJobs() {
  const response = await api('/api/media-processing/jobs')
  const previousJobs = new Map(state.jobs.map((job) => [job.episodeId, job]))
  state.jobs = response.jobs
  state.workerAvailable = response.workerAvailable
  if (state.tab === 'assets') {
    const selectedEpisode = episodeById(state.episodeId)?.episode
    const selectedJob = state.jobs.find((job) => job.episodeId === selectedEpisode?.id)
    const previous = previousJobs.get(selectedEpisode?.id)
    if (selectedJob && ['completed', 'error'].includes(selectedJob.status) && previous?.status !== selectedJob.status) {
      await refreshCatalog()
      return
    }
    const status = document.querySelector('#processing-status')
    if (status) status.outerHTML = processingStatus(selectedJob, selectedEpisode?.id)
  }
}

async function refreshAccounts() {
  state.accounts = await api('/api/accounts')
  render()
}

async function refreshAll() {
  await Promise.all([refreshCatalog(), refreshAccounts(), refreshJobs()])
}

function selectedFormData(form) {
  return Object.fromEntries(new FormData(form).entries())
}

async function saveForm(form) {
  const type = form.dataset.form
  const values = selectedFormData(form)
  const editingId = Number.isSafeInteger(state.edit[type]) ? state.edit[type] : null
  const routes = {
    account: '/api/accounts',
    title: '/api/catalog/titles',
    tag: '/api/catalog/tags',
    season: '/api/catalog/seasons',
    episode: '/api/catalog/episodes',
    asset: '/api/media-processing/episodes',
  }
  let route = routes[type]
  let method = 'POST'
  let payload = values

  if (type === 'title') {
    payload.releaseYear = values.releaseYear ? Number(values.releaseYear) : null
    payload.displayOrder = values.displayOrder ? Number(values.displayOrder) : 0
    payload.tagIds = new FormData(form).getAll('tagIds').map(Number)
  }
  if (type === 'tag') {
    payload.displayOrder = Number(values.displayOrder)
    payload.isActive = values.isActive === 'true'
  }
  if (type === 'season') {
    payload.titleId = Number(values.titleId)
    payload.number = Number(values.number)
  }
  if (type === 'episode') {
    payload.seasonId = Number(values.seasonId)
    payload.number = Number(values.number)
    payload.durationSeconds = Math.round(Number(values.durationMinutes) * 60)
  }
  if (type === 'asset') {
    payload = { path: values.path }
    route += `/${Number(values.episodeId)}`
  }
  if (type === 'account') payload = { ...values }
  if (editingId && type !== 'asset') {
    method = 'PUT'
    route += `/${editingId}`
  }

  const stateLabel = form.querySelector('.form-state')
  const submit = form.querySelector('[type="submit"]')
  submit.disabled = true
  if (stateLabel) stateLabel.textContent = 'Salvando...'
  try {
    const saved = await api(route, { method, body: JSON.stringify(payload) })
    if (type === 'title') {
      state.titleId = saved.id
      state.edit.title = saved.id
    }
    if (type === 'account') state.edit.account = saved.id
    if (type === 'tag') state.edit.tag = saved.id
    if (type === 'season') {
      state.titleId = saved.titleId
      state.seasonId = saved.id
      state.edit.season = saved.id
    }
    if (type === 'episode') {
      state.seasonId = saved.seasonId
      state.episodeId = saved.id
      state.edit.episode = saved.id
    }
    if (type === 'asset') {
      state.titleId = Number(values.titleId)
      state.seasonId = Number(values.seasonId)
      state.episodeId = saved.episodeId
      state.edit.asset = null
      state.clearMediaPathEpisodeId = saved.episodeId
    }
    if (!editingId) {
      if (type === 'account') state.edit.account = 'new'
      if (type === 'title') {
        state.edit.title = 'new'
        state.slugTouched = false
      }
      if (type === 'season') state.edit.season = null
      if (type === 'episode') state.edit.episode = null
    }
    if (type === 'account') await refreshAccounts()
    else await refreshCatalog()
    if (type === 'asset') await refreshJobs()
    showNotice(type === 'asset' ? 'MP4 salvo; o processamento continuará em segundo plano.' : `${type === 'account' && editingId ? 'Conta atualizada' : 'Cadastro salvo'} com sucesso.`)
  } catch (error) {
    showNotice(error instanceof Error ? error.message : 'Não foi possível salvar.', 'error')
  } finally {
    submit.disabled = false
    if (stateLabel) stateLabel.textContent = ''
  }
}

document.addEventListener('click', async (event) => {
  const removeTag = event.target.closest('[data-remove-tag]')
  if (removeTag) {
    const checkbox = workspace.querySelector(`input[name="tagIds"][value="${Number(removeTag.dataset.removeTag)}"]`)
    checkbox.checked = false
    updateSelectedTags()
    document.querySelector('#title-tag-search').focus()
    return
  }
  const tabButton = event.target.closest('[data-tab]')
  if (tabButton) {
    state.tab = tabButton.dataset.tab
    render()
    return
  }

  const actionButton = event.target.closest('[data-action]')
  if (actionButton?.dataset.action === 'refresh') {
    try {
      await refreshAll()
      showNotice('Dados atualizados.')
    } catch (error) {
      showNotice(error.message, 'error')
    }
    return
  }
  if (actionButton?.dataset.action === 'process-pending') {
    try {
      const result = await api('/api/media-processing/pending', { method: 'POST', body: '{}' })
      await refreshJobs()
      showNotice(`${result.queued} episódio(s) enviado(s) para verificação.`)
    } catch (error) {
      showNotice(error.message, 'error')
    }
    return
  }
  if (actionButton?.dataset.action === 'retry-episode') {
    try {
      await api(`/api/media-processing/episodes/${Number(actionButton.dataset.episode)}/retry`, { method: 'POST', body: '{}' })
      await refreshJobs()
      showNotice('Nova tentativa iniciada.')
    } catch (error) {
      showNotice(error.message, 'error')
    }
    return
  }
  if (actionButton?.dataset.action === 'new') {
    const type = { accounts: 'account', titles: 'title', tags: 'tag', seasons: 'season', episodes: 'episode', assets: 'asset' }[state.tab]
    state.edit[type] = 'new'
    if (type === 'title') state.slugTouched = false
    render()
    return
  }

  const row = event.target.closest('[data-edit]')
  if (!row) return
  const id = Number(row.dataset.id)
  if (row.dataset.edit === 'account') {
    state.tab = 'accounts'; state.edit.account = id
  } else if (row.dataset.edit === 'tag') {
    state.tab = 'tags'; state.edit.tag = id
  } else if (row.dataset.edit === 'title') {
    state.tab = 'titles'; state.titleId = id; state.edit.title = id; state.slugTouched = true
  } else if (row.dataset.edit === 'season') {
    const season = seasonById(id); state.tab = 'seasons'; state.titleId = season?.titleId; state.edit.season = id
  } else if (row.dataset.edit === 'episode') {
    const found = episodeById(id); state.tab = 'episodes'; state.titleId = found?.title.id; state.seasonId = found?.season.id; state.edit.episode = id
  } else if (row.dataset.edit === 'asset') {
    const found = episodeById(Number(row.dataset.episode));
    const asset = found?.episode.assets.find((item) => item.id === id)
    if (found && asset) {
      state.tab = 'assets'; state.titleId = found.title.id; state.seasonId = found.season.id; state.episodeId = found.episode.id
      state.edit.asset = { ...asset, episodeId: found.episode.id, key: `${found.episode.id}:${asset.format}:${asset.quality}` }
    }
  }
  render()
})

document.addEventListener('change', (event) => {
  if (event.target.name === 'tagIds') updateSelectedTags()
  const field = event.target.closest('[data-select]')
  if (!field) return
  if (field.dataset.select === 'title') {
    state.titleId = Number(field.value) || null
    state.seasonId = null
    state.episodeId = null
    if (state.tab === 'seasons') state.edit.season = null
    if (state.tab === 'episodes') state.edit.episode = null
    if (state.tab === 'assets') state.edit.asset = null
  } else if (field.dataset.select === 'season') {
    state.seasonId = Number(field.value) || null
    state.episodeId = null
    state.edit.episode = null
    state.edit.asset = null
  } else if (field.dataset.select === 'episode') {
    state.episodeId = Number(field.value) || null
    state.edit.asset = null
    state.clearMediaPathEpisodeId = null
  }
  render()
})

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-tag-search]')) {
    const query = slugify(event.target.value)
    const options = [...workspace.querySelectorAll('[data-tag-name]')]
    options.forEach((option) => { option.hidden = !option.dataset.tagName.includes(query) })
    const empty = workspace.querySelector('[data-tag-empty]')
    if (empty) empty.hidden = options.some((option) => !option.hidden)
  }
  if (event.target.name === 'name' && event.target.form?.dataset.form === 'tag') {
    document.querySelector('#tag-slug').value = slugify(event.target.value)
  }
  if (event.target.name === 'slug') state.slugTouched = true
  if (event.target.name === 'name' && event.target.form?.dataset.form === 'title' && !state.slugTouched) {
    const slugField = event.target.form.elements.namedItem('slug')
    slugField.value = slugify(event.target.value)
  }
})

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-form]')
  if (!form) return
  event.preventDefault()
  if (form.dataset.form === 'login') {
    void loginAdmin(form)
    return
  }
  if (form.dataset.form === 'backend-settings') {
    void saveBackendSettings(form)
    return
  }
  showNotice('')
  void saveForm(form)
})

let refreshTimer

function setAdminAccess(granted) {
  for (const button of document.querySelectorAll('[data-tab], [data-action="refresh"], #logout')) {
    button.disabled = !granted
  }
}

function showLogin(message = '') {
  clearInterval(refreshTimer)
  setAdminAccess(false)
  state.catalog = []
  state.accounts = []
  state.tags = []
  state.jobs = []
  databaseName.textContent = ''
  showConnection(false, 'Autenticação necessária')
  workspace.innerHTML = `${message ? `<div class="inline-note">${escapeHtml(message)}</div>` : ''}<form data-form="login">
    <h2>Entrar no KidsPlay Admin</h2>
    <div class="form-grid">
      <div class="field full"><label for="login-email">E-mail</label><input id="login-email" name="email" type="email" maxlength="254" autocomplete="username" required></div>
      <div class="field full"><label for="login-password">Senha</label><input id="login-password" name="password" type="password" maxlength="1024" autocomplete="current-password" required></div>
    </div>
    <div class="form-actions"><button class="button button-primary" type="submit">Entrar</button></div>
    <p class="inline-note">Use uma conta com privilégio administrativo provisionado no backend.</p>
  </form>`
}

function showBackendSettings(message = '') {
  setAdminAccess(false)
  showConnection(false, 'Backend indisponível')
  databaseName.textContent = ''
  workspace.innerHTML = `<form data-form="backend-settings">
    <h2>Conectar ao backend</h2>
    ${message ? `<div class="notice is-error" role="alert">${escapeHtml(message)}</div>` : ''}
    <div class="inline-note">Informe a origem HTTPS do backend do KidsPlay. Para desenvolvimento, HTTP é aceito somente em localhost. O aplicativo não inicia nem encerra o backend.</div>
    <div class="form-grid">
      <div class="field full"><label for="backend-url">Endereço da API</label><input id="backend-url" name="apiBaseUrl" type="url" maxlength="2048" placeholder="https://api.exemplo.com ou http://127.0.0.1:8788" required></div>
    </div>
    <div class="form-actions"><button class="button button-primary" type="submit">Conectar</button></div>
  </form>`
}

async function saveBackendSettings(form) {
  const button = form.querySelector('[type="submit"]')
  button.disabled = true
  try {
    const result = await window.kidsPlayAdmin.setBackend(form.elements.apiBaseUrl.value)
    if (!result.ok) throw new Error(result.error || 'Não foi possível salvar o endereço.')
    await start()
  } catch (error) {
    showBackendSettings(error instanceof Error ? error.message : 'Não foi possível configurar o backend.')
  } finally {
    button.disabled = false
  }
}

async function loginAdmin(form) {
  const button = form.querySelector('button')
  button.disabled = true
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
      email: form.elements.email.value, password: form.elements.password.value,
    }) })
    form.reset()
    if (data.user.role !== 'admin') {
      await rejectNonAdmin()
      return
    }
    showNotice('')
    await start()
  } catch (error) {
    showNotice(error.message, 'error')
  } finally {
    button.disabled = false
  }
}

async function rejectNonAdmin() {
  let message = 'Esta conta não possui acesso administrativo.'
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' })
  } catch (error) {
    message += ` Não foi possível encerrar a sessão: ${error.message}`
  }
  showLogin(message)
  showConnection(false, 'Acesso restrito')
}

document.querySelector('#logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' })
    showLogin()
    showNotice('')
  } catch (error) {
    showNotice(error.message, 'error')
  }
})

async function start() {
  try {
    clearInterval(refreshTimer)
    if (window.kidsPlayAdmin) {
      const configuration = await window.kidsPlayAdmin.getBackend()
      if (!configuration.apiBaseUrl) {
        showBackendSettings()
        return
      }
    }
    const session = await api('/api/auth/session')
    if (session.user.role !== 'admin') {
      await rejectNonAdmin()
      return
    }
    const status = await api('/api/status')
    databaseName.textContent = `${status.database_name} · MariaDB ${status.mariadb_version}`
    showConnection(true, 'Backend conectado')
    await refreshAll()
    setAdminAccess(true)
    render()
    refreshTimer = window.setInterval(() => {
      void refreshJobs().catch(error => showNotice(error.message, 'error'))
    }, 1500)
  } catch (error) {
    showConnection(false, 'Sem conexão')
    if (window.kidsPlayAdmin && error?.status === 401) {
      showLogin(error.message)
      return
    }
    if (window.kidsPlayAdmin && error?.status === 0) {
      showBackendSettings(error.message)
      return
    }
    showNotice(error instanceof Error ? error.message : 'Não foi possível carregar o painel.', 'error')
    if (!window.kidsPlayAdmin) showLogin(error.message)
  }
}

start()
document.documentElement.dataset.kidsPlayAdminLoaded = 'true'
