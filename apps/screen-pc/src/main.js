'use strict'
/**
 * Titan Screen — компьютер с Windows как экран Titan HUB.
 *
 * На основном мониторе — окно управления (src/ui): привязка, на какой монитор выводить
 * показ, как висит телевизор, предпросмотр и вкладка HUB с показом и рекламой. На
 * выбранном мониторе (телевизор по HDMI) — окно показа на весь экран (src/tv): та же
 * страница /screen/<id>, что открывает приставка Titan Menu, с поворотом.
 *
 * Монитор и поворот хранятся на сервере (screens.display_id, rotation): их меняют и
 * здесь, и в HUB. Изменение в HUB приходит сигналом по потоку и пульсом раз в 20 с.
 * Мониторы компьютера уходят в HUB в пульсе — там из них выбирают так же, как здесь.
 *
 * Закрытие окна управления прячет его в трей; показ на ТВ продолжается. Запуск —
 * вместе с Windows (--hidden: сразу в трей, если компьютер уже привязан).
 */
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, powerSaveBlocker, nativeImage, shell } = require('electron')
const os = require('node:os')
const path = require('node:path')
const { createConfig } = require('./config')
const hub = require('./hub')
const { describe, ordered, resolveChosen } = require('./displays')
const { startLocalServer, PORT } = require('./local-server')

const HEARTBEAT_MS = 20_000
/** Страница показа отмечается раз в 5 с; молчит дольше — перезагружаем. */
const WATCHDOG_MS = 90_000
const WATCHDOG_TICK_MS = 15_000
const IDENTIFY_MS = 5_000
const DISPLAY_SETTLE_MS = 800
const ROTATIONS = new Set([0, 90, 270])
const ICON = path.join(__dirname, 'assets', 'icon.png')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('ru.titan.screen')
  app.whenReady().then(start)
}

let config
let controlWin = null
let tvWin = null
let tray = null
let identifyWins = []
let stream = null
let heartbeatTimer = null
let sleepBlocker = null
let quitting = false
let localServerError = null
let lastAlive = Date.now()
let watchdogStrikes = 0

const status = {
  online: null, // null — ещё не спрашивали
  lastError: null,
  streamUp: false,
  output: null, // id монитора, на котором сейчас показ
  outputReason: 'single', // chosen | auto | missing | single | unpaired
}

// ── Мониторы ────────────────────────────────────────────────────────────────

function currentDisplays() {
  return ordered(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
}

function displaysForUi() {
  return currentDisplays().map((d, i) => ({ ...describe(d, i), index: i + 1, bounds: d.bounds, internal: d.internal ?? null }))
}

function deviceState() {
  return {
    screen: 'home',
    displays: currentDisplays().map(describe),
    output: status.output,
  }
}

const screenUrl = () => {
  const c = config.get()
  return `${c.host}/screen/${c.screenId}`
}

const tvConfig = () => ({ url: screenUrl(), rotation: ROTATIONS.has(config.get().rotation) ? config.get().rotation : 0 })

/** Поставить окно показа на нужный монитор, убрать его, если выводить некуда. */
function placeTv() {
  if (!config.isPaired()) {
    closeTv()
    status.output = null
    status.outputReason = 'unpaired'
    return
  }
  const c = config.get()
  const list = currentDisplays()
  const { display, reason } = resolveChosen(list, c.displayId, c.displayLabel)
  status.outputReason = reason
  if (!display) {
    closeTv()
    status.output = null
    return
  }
  status.output = String(display.id)
  // Запомнить название выбранного монитора: Windows может сменить ему номер.
  if (c.displayId && display.label && c.displayLabel !== display.label) config.update({ displayLabel: display.label })
  showTvOn(display)
}

function showTvOn(display) {
  const bounds = display.bounds
  if (tvWin && !tvWin.isDestroyed()) {
    const cur = tvWin.getBounds()
    const same = cur.x === bounds.x && cur.y === bounds.y && cur.width === bounds.width && cur.height === bounds.height
    if (!same) {
      // Окно на весь экран не переезжает между мониторами — выходим, двигаем, входим.
      tvWin.setFullScreen(false)
      tvWin.setBounds(bounds)
      tvWin.setFullScreen(true)
    }
    tvWin.webContents.send('tv:config', tvConfig())
    return
  }
  tvWin = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Titan Screen — ТВ',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'tv-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Мост TitanMenu нужен странице показа внутри iframe.
      nodeIntegrationInSubFrames: true,
      backgroundThrottling: false,
    },
  })
  tvWin.loadFile(path.join(__dirname, 'tv', 'tv.html'))
  tvWin.once('ready-to-show', () => {
    if (!tvWin || tvWin.isDestroyed()) return
    tvWin.setBounds(bounds)
    tvWin.setFullScreen(true)
    tvWin.showInactive() // фокус остаётся в окне управления
  })
  tvWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  tvWin.webContents.on('will-navigate', (e) => e.preventDefault())
  // Страница показа не загрузилась (нет сети, сервер перезапускается) — окно повторит.
  tvWin.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame && code !== -3 && tvWin && !tvWin.isDestroyed()) tvWin.webContents.send('tv:failed')
  })
  tvWin.webContents.on('render-process-gone', () => {
    const dead = tvWin
    tvWin = null
    if (dead && !dead.isDestroyed()) dead.destroy()
    setTimeout(placeTv, 2000)
  })
  tvWin.on('closed', () => { tvWin = null })
  lastAlive = Date.now()
  watchdogStrikes = 0
  if (!sleepBlocker || !powerSaveBlocker.isStarted(sleepBlocker)) sleepBlocker = powerSaveBlocker.start('prevent-display-sleep')
}

function closeTv() {
  if (tvWin && !tvWin.isDestroyed()) tvWin.destroy()
  tvWin = null
  if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker)) powerSaveBlocker.stop(sleepBlocker)
  sleepBlocker = null
}

function watchdog() {
  if (!tvWin || tvWin.isDestroyed()) return
  if (Date.now() - lastAlive < WATCHDOG_MS) return
  lastAlive = Date.now()
  watchdogStrikes += 1
  // Сначала перезагружаем только страницу показа, не помогло — окно целиком.
  if (watchdogStrikes === 1) tvWin.webContents.send('tv:reload')
  else tvWin.webContents.reload()
}

/** Крупные номера на всех мониторах — те же, что в HUB и в окне управления. */
function identify() {
  for (const w of identifyWins) if (!w.isDestroyed()) w.destroy()
  identifyWins = currentDisplays().map((d, i) => {
    const size = Math.min(360, Math.round(Math.min(d.workArea.width, d.workArea.height) * 0.5))
    const w = new BrowserWindow({
      x: d.workArea.x + Math.round((d.workArea.width - size) / 2),
      y: d.workArea.y + Math.round((d.workArea.height - size) / 2),
      width: size,
      height: size,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    w.setAlwaysOnTop(true, 'screen-saver')
    w.loadFile(path.join(__dirname, 'tv', 'identify.html'), {
      query: { n: String(i + 1), tv: String(d.id) === status.output ? '1' : '0' },
    })
    w.once('ready-to-show', () => w.showInactive())
    return w
  })
  setTimeout(() => {
    for (const w of identifyWins) if (!w.isDestroyed()) w.destroy()
    identifyWins = []
  }, IDENTIFY_MS)
}

// ── Сервер клуба ────────────────────────────────────────────────────────────

const appVersion = () => app.getVersion()
const deviceModel = () => `${os.hostname()} · Windows`

/** Применить то, что сервер знает об экране (ответ привязки, пульса, настроек). */
function applyServerView(view) {
  if (!view) return
  const c = config.get()
  const patch = {}
  if (typeof view.name === 'string' && view.name !== c.screenName) patch.screenName = view.name
  if (ROTATIONS.has(view.rotation) && view.rotation !== c.rotation) patch.rotation = view.rotation
  const displayId = view.displayId ?? null
  if (displayId !== (c.displayId ?? null)) {
    patch.displayId = displayId
    patch.displayLabel = displayId ? currentDisplays().find((d) => String(d.id) === displayId)?.label ?? null : null
  }
  if (Object.keys(patch).length) config.update(patch)
  placeTv()
}

async function beat() {
  if (!config.isPaired()) return
  const { host, token } = config.get()
  const sentOutput = status.output
  try {
    applyServerView(await hub.heartbeat(host, token, { appVersion: appVersion(), state: deviceState() }))
    status.online = true
    status.lastError = null
    // Сервер сменил монитор — сразу сообщить HUB, куда теперь идёт показ, а не через 20 с.
    if (status.output !== sentOutput) await hub.heartbeat(host, token, { appVersion: appVersion(), state: deviceState() }).catch(() => null)
  } catch (error) {
    if (error.status === 401) return forgetPairing('Экран отвязали в HUB — подключите компьютер заново')
    status.online = false
    status.lastError = error.message
  }
  pushState()
}

function startPaired() {
  stopPaired()
  const { host, token } = config.get()
  placeTv()
  stream = hub.openStream(host, token, {
    onSignal: handleSignal,
    onUnauthorized: () => forgetPairing('Экран отвязали в HUB — подключите компьютер заново'),
    onState: (up) => { status.streamUp = up; pushState() },
  })
  void beat()
  heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_MS)
}

function stopPaired() {
  stream?.stop()
  stream = null
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  status.streamUp = false
}

function handleSignal(signal) {
  if (signal?.type === 'settings') return void beat()
  if (signal?.type !== 'command') return
  const command = signal.command || {}
  if (command.action === 'identify') identify()
  if (command.action === 'message' && tvWin && !tvWin.isDestroyed()) {
    tvWin.webContents.send('tv:message', { text: String(command.text || ''), seconds: Number(command.seconds) || 20 })
  }
}

function forgetPairing(reason) {
  stopPaired()
  config.unpair()
  closeTv()
  status.online = null
  status.output = null
  status.outputReason = 'unpaired'
  status.lastError = reason || null
  showControl()
  pushState()
  rebuildTray()
}

async function pairWith(host, secret) {
  const c = config.get()
  const view = await hub.claim(host, { secret, deviceId: c.deviceId, model: deviceModel(), appVersion: appVersion() })
  config.update({
    host,
    token: view.token,
    screenId: view.screenId,
    screenName: view.name,
    rotation: ROTATIONS.has(view.rotation) ? view.rotation : 0,
    displayId: view.displayId ?? null,
    displayLabel: null,
  })
  status.lastError = null
  startPaired()
  pushState()
  rebuildTray()
  return view
}

// ── Привязка с телефона (локальная сеть) ────────────────────────────────────

function localIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address)
}

const localListener = {
  info() {
    const c = config.get()
    return {
      deviceId: c.deviceId,
      code: c.pairCode,
      name: `Titan Screen ${c.pairCode}`,
      model: deviceModel(),
      appVersion: appVersion(),
      app: 'desktop',
      paired: config.isPaired(),
      screenName: config.isPaired() ? c.screenName ?? null : null,
    }
  },
  async pair({ host, secret, code }) {
    const c = config.get()
    if (config.isPaired()) return [409, { ok: false, error: `Компьютер уже показывает экран «${c.screenName ?? ''}». Сначала отвяжите его.` }]
    if (code !== c.pairCode) return [403, { ok: false, error: 'Код не совпадает с кодом на экране компьютера' }]
    try {
      const view = await pairWith(host, secret)
      return [200, { ok: true, name: view.name }]
    } catch (error) {
      return [502, { ok: false, error: error.message }]
    }
  },
}

// ── Окно управления ─────────────────────────────────────────────────────────

function uiState() {
  const c = config.get()
  return {
    paired: config.isPaired(),
    pairCode: c.pairCode,
    ips: localIps(),
    port: PORT,
    localServerError,
    host: c.host ?? null,
    screenId: c.screenId ?? null,
    screenName: c.screenName ?? null,
    screenUrl: config.isPaired() ? screenUrl() : null,
    hubUrl: config.isPaired() ? `${c.host}/manage/screens/${c.screenId}` : null,
    rotation: c.rotation ?? 0,
    displayId: c.displayId ?? null,
    displays: displaysForUi(),
    output: status.output,
    outputReason: status.outputReason,
    online: status.online,
    streamUp: status.streamUp,
    lastError: status.lastError,
    appVersion: appVersion(),
    autostart: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
  }
}

function pushState() {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('state', uiState())
}

function createControl(show) {
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.min(1180, primary.width - 40)
  const height = Math.min(800, primary.height - 40)
  controlWin = new BrowserWindow({
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Titan Screen',
    icon: ICON,
    backgroundColor: '#0d0b14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // вкладка HUB
    },
  })
  controlWin.removeMenu()
  controlWin.loadFile(path.join(__dirname, 'ui', 'index.html'))
  controlWin.once('ready-to-show', () => { if (show) controlWin.show() })
  controlWin.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    controlWin.hide()
  })
  controlWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Вкладка HUB: только сайт клуба, без доступа к Node, вход сохраняется между запусками.
  controlWin.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    const host = config.get().host
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!host || !String(params.src || '').startsWith(`${host}/`)) e.preventDefault()
  })
  controlWin.webContents.on('did-attach-webview', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

function showControl() {
  if (!controlWin || controlWin.isDestroyed()) createControl(true)
  else {
    if (controlWin.isMinimized()) controlWin.restore()
    controlWin.show()
    controlWin.focus()
  }
}

function rebuildTray() {
  if (!tray) return
  const c = config.get()
  tray.setToolTip(config.isPaired() ? `Titan Screen — «${c.screenName ?? ''}»` : 'Titan Screen — не подключён')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть управление', click: showControl },
    { label: 'Показать номера мониторов', click: identify },
    { label: 'Перезагрузить показ', enabled: config.isPaired(), click: () => tvWin?.webContents.reload() },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit() } },
  ]))
}

// ── IPC окна управления ─────────────────────────────────────────────────────

const ok = () => ({ ok: true })
const fail = (error) => ({ ok: false, error: error?.message || String(error) })

/** Монитор или поворот из приложения: сразу на ТВ, потом на сервер (то же поле, что в HUB). */
async function saveDeviceSettings(patch) {
  const before = config.get()
  config.update(patch)
  placeTv()
  pushState()
  try {
    applyServerView(await hub.saveSettings(before.host, before.token, {
      ...('displayId' in patch ? { displayId: patch.displayId } : {}),
      ...('rotation' in patch ? { rotation: patch.rotation } : {}),
    }))
    pushState()
    void beat() // HUB сразу видит, на каком мониторе теперь показ
    return ok()
  } catch (error) {
    if (error.status === 401) {
      forgetPairing('Экран отвязали в HUB — подключите компьютер заново')
      return fail(error)
    }
    // Не сохранилось — вернуть как было, чтобы здесь и в HUB было одно и то же.
    config.update({ displayId: before.displayId ?? null, displayLabel: before.displayLabel ?? null, rotation: before.rotation ?? 0 })
    placeTv()
    pushState()
    return fail(error)
  }
}

function registerIpc() {
  ipcMain.handle('state:get', () => uiState())
  ipcMain.handle('pair:code', async (_e, { host, code }) => {
    const normalized = hub.normalizeHost(host)
    if (!normalized) return fail(new Error('Введите адрес клуба, например kbr.titanpos.ru'))
    const clean = String(code || '').replace(/[\s-]/g, '').toUpperCase()
    if (clean.length !== 8) return fail(new Error('Код из HUB — 8 знаков'))
    try {
      await pairWith(normalized, clean)
      return ok()
    } catch (error) {
      return fail(error)
    }
  })
  ipcMain.handle('display:set', (_e, id) => {
    if (!config.isPaired()) return fail(new Error('Компьютер не подключён'))
    const displayId = id ? String(id) : null
    const label = displayId ? currentDisplays().find((d) => String(d.id) === displayId)?.label ?? null : null
    return saveDeviceSettings({ displayId, displayLabel: label })
  })
  ipcMain.handle('rotation:set', (_e, rotation) => {
    if (!config.isPaired()) return fail(new Error('Компьютер не подключён'))
    if (!ROTATIONS.has(rotation)) return fail(new Error('Поворот — 0, 90 или 270'))
    return saveDeviceSettings({ rotation })
  })
  ipcMain.handle('identify', () => { identify(); return ok() })
  ipcMain.handle('tv:reload', () => { tvWin?.webContents.reload(); return ok() })
  ipcMain.handle('unpair', async () => {
    const { host, token } = config.get()
    if (host && token) await hub.unpair(host, token)
    forgetPairing(null)
    return ok()
  })
  ipcMain.handle('autostart:set', (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] })
    pushState()
    return ok()
  })
  ipcMain.handle('open:external', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) void shell.openExternal(String(url))
    return ok()
  })

  // Окно показа
  ipcMain.handle('tv:get-config', () => (config.isPaired() ? tvConfig() : null))
  ipcMain.on('tv:alive', () => { lastAlive = Date.now(); watchdogStrikes = 0 })
}

// ── Запуск ──────────────────────────────────────────────────────────────────

function start() {
  config = createConfig(app.getPath('userData'))
  registerIpc()

  // Первый запуск установленной версии — сразу в автозапуск: компьютер у ТВ должен
  // показывать сам после перезагрузки. Запуск из исходников (npm start) автозапуск не трогает.
  if (app.isPackaged && !config.get().autostartSet) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    config.update({ autostartSet: true })
  }

  startLocalServer(localListener, (error) => {
    localServerError = error.code === 'EADDRINUSE'
      ? `Порт ${PORT} занят другой программой — найти компьютер с телефона не получится, подключите кодом из HUB`
      : `Поиск с телефона недоступен: ${error.message}`
    pushState()
  })

  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.on('click', showControl)
  rebuildTray()

  const hidden = process.argv.includes('--hidden') && config.isPaired()
  createControl(!hidden)
  if (config.isPaired()) startPaired()
  else placeTv()

  let settle = null
  const onDisplaysChanged = () => {
    clearTimeout(settle)
    settle = setTimeout(() => {
      placeTv()
      void beat()
      pushState()
    }, DISPLAY_SETTLE_MS)
  }
  screen.on('display-added', onDisplaysChanged)
  screen.on('display-removed', onDisplaysChanged)
  screen.on('display-metrics-changed', onDisplaysChanged)

  setInterval(watchdog, WATCHDOG_TICK_MS)
  // Адреса в сети меняются (DHCP, другой Wi‑Fi) — экран подключения показывает свежие.
  setInterval(() => { if (!config.isPaired()) pushState() }, 10_000)
}

app.on('second-instance', () => showControl())
app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => { /* живём в трее */ })
