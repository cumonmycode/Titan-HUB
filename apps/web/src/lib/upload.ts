/**
 * Загрузка фото в хранилище HUB (MinIO через /api/upload/image) со сжатием на
 * устройстве: общий лимит тела запроса API — 1 МБ, фото с телефона его превышают.
 */
import { useAuthStore } from '@/store/auth.store'

// Сжатие до 1920 px по длинной стороне и 1080 по короткой (JPEG < 900 КБ): общий
// лимит тела запроса API — 1 МБ, фото с телефона его превышают. Вертикальная
// картинка для вертикального ТВ остаётся 1080×1920, а не ужимается до 608 px.
async function compressImage(file: File): Promise<Blob> {
  const src = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Не удалось прочитать картинку'))
      i.src = src
    })
    const long = Math.max(img.naturalWidth, img.naturalHeight)
    const short = Math.min(img.naturalWidth, img.naturalHeight)
    const scale = Math.min(1, 1920 / long, 1080 / short)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось обработать картинку')
    ctx.fillStyle = '#0b0810' // прозрачный PNG — на фоне экрана, а не на чёрном
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    for (const q of [0.86, 0.76, 0.66]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))
      if (blob && blob.size < 900 * 1024) return blob
    }
    throw new Error('Картинка слишком тяжёлая даже после сжатия')
  } finally {
    URL.revokeObjectURL(src)
  }
}

/** Сжать и загрузить картинку в хранилище HUB; вернуть публичную ссылку. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await compressImage(file)
  const fd = new FormData()
  fd.append('file', blob, 'photo.jpg')
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api'
  const token = useAuthStore.getState().token
  const res = await fetch(`${base}/upload/image`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
  if (!res.ok) {
    const e = await res.json().catch(() => null)
    throw new Error(e?.error || 'Не удалось загрузить картинку')
  }
  return (await res.json()).url as string
}
