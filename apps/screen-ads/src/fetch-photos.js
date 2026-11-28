/**
 * Скачать выбранные фото (photos.json) в .cache/photos: из архива — превью Google Диска
 * нужного размера (lh3, без ключа), с сайта — копия из apps/site/public/media.
 * Уже скачанные не трогаем.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, '.cache', 'photos')
const SITE_MEDIA = path.join(ROOT, '..', 'site', 'public', 'media')
const SIZE = { land: 'w1920-h1280', port: 'w1080-h1620' }
const PARALLEL = 6

async function fetchOne({ id, o }) {
  const file = path.join(DIR, `${id.replace(':', '_')}.${id.startsWith('site:') ? 'webp' : 'jpg'}`)
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) return 'есть'
  if (id.startsWith('site:')) {
    fs.copyFileSync(path.join(SITE_MEDIA, `${id.slice(5)}-1600.webp`), file)
    return 'сайт'
  }
  const res = await fetch(`https://lh3.googleusercontent.com/d/${id}=${SIZE[o]}`)
  if (!res.ok) throw new Error(`${id}: ${res.status}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return 'скачано'
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true })
  const all = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'photos.json'), 'utf8'))).flat()
  const queue = [...new Map(all.map((p) => [p.id, p])).values()]
  const stat = {}
  const errors = []
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const p = queue.shift()
      try { const r = await fetchOne(p); stat[r] = (stat[r] || 0) + 1 } catch (e) { errors.push(e.message) }
    }
  }))
  console.log(stat, errors.length ? `ошибки: ${errors.join('; ')}` : 'без ошибок')
  if (errors.length) process.exitCode = 1
}

main()
