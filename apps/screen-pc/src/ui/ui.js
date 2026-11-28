'use strict'
/**
 * Окно управления Titan Screen. Всё состояние — из главного процесса (window.titan),
 * здесь только отрисовка и действия. Монитор и поворот сохраняются на сервере клуба —
 * это те же настройки, что на странице экрана в HUB.
 */
const $ = (id) => document.getElementById(id)
let state = null
let busy = false
let previewUrl = null
let hubLoadedFor = null
let toastTimer = null

function toast(text, isError) {
  const el = $('toast')
  el.textContent = text
  el.className = isError ? 'error' : ''
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 3500)
}

async function act(promise, success) {
  if (busy) return
  busy = true
  try {
    const res = await promise
    if (res && res.ok === false) toast(res.error || 'Не получилось', true)
    else if (success) toast(success)
  } finally {
    busy = false
  }
}

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

// ── Не подключён ────────────────────────────────────────────────────────────

function renderPair(s) {
  $('pair-code').textContent = s.pairCode
  $('pair-ips').textContent = s.ips.length ? s.ips.join(', ') : 'нет сети'
  $('local-error').hidden = !s.localServerError
  $('local-error').textContent = s.localServerError || ''
  $('pair-error').hidden = !s.lastError
  $('pair-error').textContent = s.lastError || ''
}

$('pair-input').addEventListener('input', (e) => {
  const raw = e.target.value.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 8)
  e.target.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
})

$('pair-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const button = $('pair-submit')
  button.disabled = true
  button.textContent = 'Подключаем…'
  try {
    const res = await window.titan.pairWithCode($('pair-host').value, $('pair-input').value)
    if (!res.ok) {
      $('pair-error').hidden = false
      $('pair-error').textContent = res.error
    } else {
      $('pair-input').value = ''
    }
  } finally {
    button.disabled = false
    button.textContent = 'Подключить'
  }
})

// ── Подключён ───────────────────────────────────────────────────────────────

function statusOf(s) {
  if (s.online === false) return { color: 'var(--amber)', text: s.lastError || 'Нет связи с сервером клуба — показ идёт из сохранённого' }
  if (s.online === null) return { color: 'var(--muted)', text: 'Подключаемся…' }
  const where = s.host.replace(/^https?:\/\//, '')
  return { color: 'var(--green)', text: s.streamUp ? `В сети · ${where}` : `В сети · ${where} · пульт HUB переподключается` }
}

function outputNote(s) {
  const out = s.displays.find((d) => d.id === s.output)
  switch (s.outputReason) {
    case 'chosen': return out ? `Показ на мониторе ${out.index}. На основном мониторе остаётся это окно.` : ''
    case 'auto': return out ? `Сам выбрал монитор ${out.index} — первый не основной.` : ''
    case 'missing': return 'Выбранный монитор не подключён — показ появится, как только его включат. Или выберите другой.'
    case 'single': return 'Подключён один монитор. Подключите телевизор по HDMI — показ появится на нём сам.'
    default: return ''
  }
}

function renderLayout(s) {
  const box = $('layout')
  box.replaceChildren()
  const list = s.displays
  if (!list.length) return
  const minX = Math.min(...list.map((d) => d.bounds.x))
  const minY = Math.min(...list.map((d) => d.bounds.y))
  const maxX = Math.max(...list.map((d) => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...list.map((d) => d.bounds.y + d.bounds.height))
  const pad = 16
  const W = box.clientWidth - pad * 2
  const H = box.clientHeight - pad * 2
  const scale = Math.min(W / (maxX - minX), H / (maxY - minY))
  const offX = pad + (W - (maxX - minX) * scale) / 2
  const offY = pad + (H - (maxY - minY) * scale) / 2
  for (const d of list) {
    const mon = el('button', 'mon')
    mon.type = 'button'
    mon.style.left = `${offX + (d.bounds.x - minX) * scale + 3}px`
    mon.style.top = `${offY + (d.bounds.y - minY) * scale + 3}px`
    mon.style.width = `${d.bounds.width * scale - 6}px`
    mon.style.height = `${d.bounds.height * scale - 6}px`
    if (s.displayId === d.id) mon.classList.add('chosen')
    if (s.output === d.id) mon.classList.add('output')
    mon.title = `${d.label} · ${d.width}×${d.height}${d.primary ? ' · основной' : ''}`
    mon.append(el('b', null, String(d.index)), el('small', null, d.primary ? 'основной' : d.label), el('small', null, `${d.width}×${d.height}`))
    mon.addEventListener('click', () => {
      if (s.displayId === d.id) return
      if (d.primary && !confirm('Это основной монитор: показ закроет его целиком, окно управления останется в трее. Вывести показ сюда?')) return
      void act(window.titan.setDisplay(d.id), `Показ на мониторе ${d.index}`)
    })
    box.append(mon)
  }
}

function renderChips(s) {
  const chips = $('display-chips')
  chips.replaceChildren()
  const auto = el('button', s.displayId === null ? 'active' : '', 'Сам выберет')
  auto.addEventListener('click', () => { if (s.displayId !== null) void act(window.titan.setDisplay(null), 'Монитор выбирается сам') })
  chips.append(auto)
  if (s.displayId && !s.displays.some((d) => d.id === s.displayId)) chips.append(el('button', 'active', 'Выбранный монитор отключён'))
}

function renderPreview(s) {
  const wrap = $('preview')
  const frame = $('preview-frame')
  const vertical = s.rotation === 90 || s.rotation === 270
  // Страница видит экран таким, каким его видит гость: вертикальный ТВ — вертикальная страница.
  const pageW = vertical ? 1080 : 1920
  const pageH = vertical ? 1920 : 1080
  const boxW = wrap.clientWidth
  const boxH = wrap.clientHeight
  const scale = Math.min(boxW / pageW, boxH / pageH)
  frame.style.width = `${pageW}px`
  frame.style.height = `${pageH}px`
  frame.style.transform = `translate(${(boxW - pageW * scale) / 2}px, ${(boxH - pageH * scale) / 2}px) scale(${scale})`
  if (s.screenUrl && previewUrl !== s.screenUrl) {
    previewUrl = s.screenUrl
    frame.src = s.screenUrl
  }
}

function renderMain(s) {
  $('screen-name').textContent = s.screenName || 'Экран'
  const st = statusOf(s)
  $('status-dot').style.background = st.color
  $('status-text').textContent = st.text
  renderLayout(s)
  renderChips(s)
  $('output-note').textContent = outputNote(s)
  $('identify').disabled = !s.displays.length
  for (const b of document.querySelectorAll('#rotation button')) b.classList.toggle('active', Number(b.dataset.rotation) === s.rotation)
  renderPreview(s)
  $('autostart').checked = s.autostart
  $('pc-info').textContent = `Titan Screen ${s.appVersion} · ${s.ips.join(', ') || 'нет сети'}`
}

function render(s) {
  state = s
  $('pair-view').hidden = s.paired
  $('main-view').hidden = !s.paired
  if (!s.paired) {
    previewUrl = null
    hubLoadedFor = null
    $('hub-frame').replaceChildren()
    renderPair(s)
    return
  }
  renderMain(s)
}

for (const b of document.querySelectorAll('#rotation button')) {
  b.addEventListener('click', () => {
    const rotation = Number(b.dataset.rotation)
    if (state && rotation !== state.rotation) void act(window.titan.setRotation(rotation), 'Поворот сохранён')
  })
}
$('identify').addEventListener('click', () => void act(window.titan.identify()))
$('reload').addEventListener('click', () => {
  previewUrl = null
  void act(window.titan.reloadTv(), 'Показ перезагружен')
  if (state) renderPreview(state)
})
$('autostart').addEventListener('change', (e) => void act(window.titan.setAutostart(e.target.checked)))
$('unpair').addEventListener('click', () => {
  if (confirm('Отвязать компьютер? Телевизор перестанет показывать экран, а здесь снова появится код для подключения.')) void act(window.titan.unpair())
})

// ── Вкладки ─────────────────────────────────────────────────────────────────

function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === name)
  $('tab-tv').hidden = name !== 'tv'
  $('tab-hub').hidden = name !== 'hub'
  if (name === 'hub' && state?.hubUrl && hubLoadedFor !== state.hubUrl) {
    // HUB — в своём хранилище: вход сохраняется между запусками.
    const view = document.createElement('webview')
    view.setAttribute('partition', 'persist:hub')
    view.setAttribute('src', state.hubUrl)
    $('hub-frame').replaceChildren(view)
    hubLoadedFor = state.hubUrl
  }
  if (name === 'tv' && state) renderMain(state)
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab))
$('open-hub-tab').addEventListener('click', () => showTab('hub'))
$('hub-external').addEventListener('click', () => { if (state?.hubUrl) void window.titan.openExternal(state.hubUrl) })

window.addEventListener('resize', () => { if (state?.paired) { renderLayout(state); renderPreview(state) } })
window.titan.onState(render)
window.titan.getState().then(render)
