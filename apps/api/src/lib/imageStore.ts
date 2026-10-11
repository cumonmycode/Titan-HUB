// Сохранение загруженной картинки в MinIO: общая часть /upload/image и фото из
// анкеты нового клиента My Titan (/auth/app/photo).
import * as Minio from 'minio'

// Бакет и публичный путь согласованы с nginx: location /media/ переписывает
// /media/<файл> → minio:9000/titan-hub/<файл>. Раньше файлы клались в
// 'titan-uploads', а ссылка строилась как /media/titan-uploads/<файл> — nginx
// искал её в titan-hub и отдавал 404.
const BUCKET = 'titan-hub'
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
// Тело запроса = файл + заголовки multipart. Общий предел /api/* (1 МБ) сюда не применяется.
export const MAX_UPLOAD_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024
// Только изображения. Расширение берём из MIME, не из имени файла (анти-подмена).
// SVG не допускаем — может содержать активный скрипт.
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Сниффинг magic-bytes: заголовок MIME от клиента подделываем, поэтому проверяем
// реальные первые байты файла. SVG остаётся исключённым (это текст без сигнатуры,
// может нести активный скрипт). Возвращает канонический MIME по байтам или null,
// если ни одна разрешённая сигнатура изображения не совпала.
function sniffImageType(buf: Buffer): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: "GIF8" (покрывает GIF87a / GIF89a)
  if (
    buf.length >= 4 &&
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38
  ) {
    return 'image/gif'
  }
  // WEBP: "RIFF" .... "WEBP" (RIFF в начале, WEBP по смещению 8)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function getMinioClient() {
  const endpoint = process.env['MINIO_ENDPOINT'] ?? 'minio'
  const port = parseInt(process.env['MINIO_PORT'] ?? '9000')
  const accessKey = process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin'
  const secretKey = process.env['MINIO_SECRET_KEY'] ?? 'minioadmin'
  return new Minio.Client({ endPoint: endpoint, port, useSSL: false, accessKey, secretKey })
}

export type StoreImageResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 500; error: string }

/** Проверить файл (тип по байтам, размер) и положить в MinIO; вернуть публичную ссылку. */
export async function storeImage(file: File | string | null): Promise<StoreImageResult> {
  if (!file || typeof file === 'string') return { ok: false, status: 400, error: 'No file provided' }
  if (!ALLOWED_TYPES[file.type]) return { ok: false, status: 400, error: 'Допустимы только изображения: JPEG, PNG, WebP, GIF' }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, status: 400, error: 'Файл больше 8 МБ' }

  // Читаем буфер заранее и сверяем magic-bytes: даже если заголовок MIME прошёл
  // проверку выше, реальное содержимое должно совпадать с разрешённой сигнатурой.
  const buffer = Buffer.from(await file.arrayBuffer())
  const sniffedType = sniffImageType(buffer)
  if (!sniffedType || !ALLOWED_TYPES[sniffedType]) {
    return { ok: false, status: 400, error: 'Содержимое файла не является допустимым изображением' }
  }

  // Тип и расширение берём из РЕАЛЬНЫХ байтов (sniffedType), не из заголовка.
  const ext = ALLOWED_TYPES[sniffedType]
  const objectName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  try {
    const client = getMinioClient()
    // Ensure bucket exists
    const exists = await client.bucketExists(BUCKET)
    if (!exists) {
      await client.makeBucket(BUCKET)
      await client.setBucketPolicy(BUCKET, JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${BUCKET}/*`] }],
      }))
    }

    // Content-Type из проверенного по байтам типа, а не из подделываемого заголовка.
    await client.putObject(BUCKET, objectName, buffer, buffer.length, { 'Content-Type': sniffedType })

    return { ok: true, url: `${process.env['MINIO_PUBLIC_URL'] ?? 'http://localhost:9000'}/${objectName}` }
  } catch (e: any) {
    console.error('[upload] не удалось сохранить файл в MinIO:', e?.code ?? '', e?.message ?? e)
    return { ok: false, status: 500, error: e?.message ?? 'Не удалось сохранить файл' }
  }
}
