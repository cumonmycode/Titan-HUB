/**
 * Сборка сцен в dist/: <id>.html на каждую сцену + общие ads.css, motion.js, gsap,
 * шрифты и media/ (фото архива, фото и экраны с сайта, логотип). dist/scenes.json —
 * список сцен с версией (хэш содержимого) для ссылки ?v= — экран не возьмёт старое из кэша.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const QRCode = require('qrcode')
const scenes = require('./scenes')
const { T, QR_POS } = require('./templates')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const SITE_MEDIA = path.join(ROOT, '..', 'site', 'public', 'media')
const SITE = 'https://www.titanmafia.ru'
const photos = JSON.parse(fs.readFileSync(path.join(ROOT, 'photos.json'), 'utf8'))

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) }
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10)

function copyStatic() {
  copy(path.join(__dirname, 'ads.css'), path.join(DIST, 'ads.css'))
  copy(path.join(__dirname, 'motion.js'), path.join(DIST, 'motion.js'))
  copy(require.resolve('gsap/dist/gsap.min.js'), path.join(DIST, 'gsap.min.js'))
  const fonts = path.join(path.dirname(require.resolve('@fontsource-variable/onest/package.json')), 'files')
  copy(path.join(fonts, 'onest-cyrillic-wght-normal.woff2'), path.join(DIST, 'fonts', 'onest-cyrillic.woff2'))
  copy(path.join(fonts, 'onest-latin-wght-normal.woff2'), path.join(DIST, 'fonts', 'onest-latin.woff2'))
  copy(path.join(SITE_MEDIA, 'logo-512.png'), path.join(DIST, 'media', 'logo.png'))
  for (const f of ['book-red', 'book-rules', 'book-zen']) copy(path.join(SITE_MEDIA, `${f}-800.webp`), path.join(DIST, 'media', `${f}.webp`))
  for (const f of fs.readdirSync(SITE_MEDIA).filter((n) => /^app-[a-z0-9-]+\.webp$/.test(n))) copy(path.join(SITE_MEDIA, f), path.join(DIST, 'media', f))
}

/** Фото сцены в media/ — путь для разметки. */
function photoUrl({ id }) {
  const site = id.startsWith('site:')
  const file = site ? `${id.slice(5)}.webp` : `${id}.jpg`
  const src = path.join(ROOT, '.cache', 'photos', site ? `site_${id.slice(5)}.webp` : `${id}.jpg`)
  if (!fs.existsSync(src)) throw new Error(`нет фото ${id} — запустите npm run fetch`)
  copy(src, path.join(DIST, 'media', file))
  return `media/${file}`
}

async function qrBlock(s) {
  const url = s.qrUrl || SITE + s.qr
  const label = s.qrLabel || 'titanmafia.ru' + s.qr
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0d0a18', light: '#ffffff' } })
  let pos = QR_POS[s.tpl]
  if (pos === 'auto') pos = ['wanted', 'dossier', 'ticket'].includes(s.paper) ? 'qcol' : 'inline'
  const cls = pos === 'inline' || pos === 'mag' ? '' : pos
  return `<div class="qr ${cls}"><div class="qc">${svg}</div><div class="qt"><b>${s.qt}</b><span>${label}</span></div></div>`
}

function page(s, body, ver) {
  const cls = `stage t-${s.tpl}${s.tpl === 'faq' && s.tone === 'light' ? ' light-tone' : ''}`
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TITAN · ${s.id}</title><link rel="stylesheet" href="ads.css?v=${ver}"></head>
<body><div class="${cls}" data-tpl="${s.tpl}">${body}</div><script src="gsap.min.js?v=${ver}"></script><script src="motion.js?v=${ver}"></script></body></html>\n`
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true })
  copyStatic()
  const shared = sha(Buffer.concat(['ads.css', 'motion.js', 'gsap.min.js'].map((f) => fs.readFileSync(path.join(DIST, f)))))
  const list = []
  for (const s of scenes) {
    if (!T[s.tpl]) throw new Error(`${s.id}: нет шаблона ${s.tpl}`)
    const ph = (photos[s.id] || []).map(photoUrl)
    const html = page(s, T[s.tpl](s, ph, await qrBlock(s)), shared)
    fs.writeFileSync(path.join(DIST, `${s.id}.html`), html)
    const v = sha(Buffer.concat([Buffer.from(html + shared), ...ph.map((u) => fs.readFileSync(path.join(DIST, u)))]))
    list.push({ id: s.id, file: `${s.id}.html`, tpl: s.tpl, v })
  }
  fs.writeFileSync(path.join(DIST, 'scenes.json'), JSON.stringify(list, null, 1) + '\n')
  const size = fs.readdirSync(path.join(DIST, 'media')).reduce((n, f) => n + fs.statSync(path.join(DIST, 'media', f)).size, 0)
  console.log(`${list.length} сцен, ${new Set(list.map((x) => x.tpl)).size} шаблонов, media ${(size / 1e6).toFixed(1)} МБ`)
}

main().catch((e) => { console.error(e.message); process.exitCode = 1 })
