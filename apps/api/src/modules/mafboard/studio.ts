// ─────────────────────────────────────────────────────────────────────────────
// Настройки MafBoard Studio в облаке: коллекция профилей ведущего (качество, сцены, площадки,
// каналы чатов, устройства…) и его секреты (ключи потоков площадок, ключ YouTube Data API).
//
// Документ хранится как есть: его смысл знает только MBS. Секреты шифруются ключом сервера
// (AES-256-GCM) и отдаются только самому ведущему. Запись — по ревизии: если на другом Mac
// успели сохранить новее, сервер отвечает 409 и отдаёт текущую версию для слияния.
// ─────────────────────────────────────────────────────────────────────────────

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'

/** Профилей у ведущего может быть много, но это всё ещё настройки, а не медиа. */
export const STUDIO_BODY_LIMIT_BYTES = 512 * 1024
/** Ключи потоков и API — десятки строк; больше — значит, туда положили не то. */
export const STUDIO_SECRETS_LIMIT_BYTES = 64 * 1024
export const STUDIO_SAVES_PER_HOUR = 600
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const SEALED_VERSION = 'v1'

export const studioPutSchema = z.object({
  /** Ревизия, от которой MBS делал изменения. 0 — у ведущего ещё ничего не сохранено. */
  baseRevision: z.number().int().min(0),
  document: z.record(z.string(), z.unknown()),
  secrets: z.record(z.string(), z.unknown()).nullable(),
})

/**
 * Ключ шифрования секретов студии. Свой из MAFBOARD_STUDIO_SECRETS_KEY (base64, 32 байта) или
 * выведенный из MAFBOARD_JWT_SECRET: при смене JWT-секрета без своего ключа сохранённые
 * ключи площадок перестанут читаться, и MBS попросит ввести их заново.
 */
export function studioSecretsKey(env: NodeJS.ProcessEnv, jwtSecret: Uint8Array): Uint8Array | string {
  const own = env['MAFBOARD_STUDIO_SECRETS_KEY']?.trim()
  if (own) {
    const key = Buffer.from(own, 'base64')
    return key.length === KEY_BYTES ? new Uint8Array(key) : 'MAFBOARD_STUDIO_SECRETS_KEY должен быть 32 байтами в base64'
  }
  return new Uint8Array(hkdfSync('sha256', jwtSecret, 'mafboard-studio', 'studio-secrets-v1', KEY_BYTES))
}

/** `v1.<iv>.<tag>.<шифротекст>` в base64url. */
export function sealSecrets(key: Uint8Array, value: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [SEALED_VERSION, iv, cipher.getAuthTag(), body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
}

/** null — запись повреждена или зашифрована другим ключом. */
export function openSecrets(key: Uint8Array, sealed: string): Record<string, unknown> | null {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== SEALED_VERSION || !iv || !tag || body === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    const tagBytes = Buffer.from(tag, 'base64url')
    if (tagBytes.length !== TAG_BYTES) return null
    decipher.setAuthTag(tagBytes)
    const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
