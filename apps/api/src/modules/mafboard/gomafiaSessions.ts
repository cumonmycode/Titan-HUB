import { hkdfSync } from 'node:crypto'
import type { Context } from 'hono'
import { GomafiaAuthRequired, type GomafiaAuth } from '../../lib/gomafia.js'
import type { AimAccounts } from './aim.js'
import type { GoMafiaGateway } from './gomafia.js'
import type { MafboardRepo } from './repo.js'
import { fail } from './router.js'
import { openSecrets, sealSecrets } from './studio.js'

// ─────────────────────────────────────────────────────────────────────────────
// Вход в GoMafia от имени пользователя. С 2026-11-17 сайт отдаёт профили, клубы, страницы
// турниров и поиск игроков только вошедшим: сервер входит логином и паролем самого ведущего
// (сохранены шифротекстом при привязке; для привязавших раньше — вход в АИМ, обычно тот же)
// и держит cookie сессии в памяти. Сайт снова просит войти — один повторный вход.
// ─────────────────────────────────────────────────────────────────────────────

const KEY_BYTES = 32

/** Входа в GoMafia нет или он не принят: приложение просит войти в GoMafia заново. */
export class GoMafiaLoginRequired extends Error {
  constructor() {
    super('gomafia_relogin_required')
  }
}

/** GoMafia не ответила на вход — сбой сети, а не неверный пароль. */
export class GoMafiaUnavailable extends Error {
  constructor() {
    super('gomafia_unavailable')
  }
}

interface Credentials {
  login: string
  password: string
}

const TRANSPORT_ERRORS = new Set(['network', 'bad_json'])

export class GoMafiaSessions {
  private readonly cookies = new Map<string, string>()
  private readonly key: Uint8Array

  constructor(
    private readonly repo: MafboardRepo,
    private readonly gateway: GoMafiaGateway,
    secretsKey: Uint8Array,
    private readonly aim: AimAccounts,
    private readonly now: () => Date,
  ) {
    this.key = new Uint8Array(hkdfSync('sha256', secretsKey, 'mafboard-gomafia', 'gomafia-credentials-v1', KEY_BYTES))
  }

  /** После привязки: пароль только что подтверждён — сохраняем его и cookie этого входа. */
  async remember(userId: string, login: string, password: string, cookie: string | null): Promise<void> {
    await this.repo.setGomafiaCredentials(userId, sealSecrets(this.key, { login, password }), this.now())
    if (cookie) this.cookies.set(userId, cookie)
    else this.cookies.delete(userId)
  }

  async forget(userId: string): Promise<void> {
    this.cookies.delete(userId)
    await this.repo.setGomafiaCredentials(userId, null, this.now())
  }

  /**
   * Запрос в GoMafia от имени пользователя. Нет cookie или сайт просит войти — вход сохранённым
   * паролем и один повтор. Входа нет или он не принят — GoMafiaLoginRequired.
   */
  async run<T>(userId: string, job: (auth: GomafiaAuth) => Promise<T>): Promise<T> {
    const cached = this.cookies.get(userId)
    if (cached) {
      try {
        return await job({ cookie: cached })
      } catch (error) {
        if (!(error instanceof GomafiaAuthRequired)) throw error
        this.cookies.delete(userId)
      }
    }
    const cookie = await this.login(userId)
    try {
      return await job({ cookie })
    } catch (error) {
      if (error instanceof GomafiaAuthRequired) throw new GoMafiaLoginRequired()
      throw error
    }
  }

  private async credentials(userId: string): Promise<Credentials | null> {
    const sealed = await this.repo.gomafiaCredentials(userId)
    const own = sealed ? openSecrets(this.key, sealed) : null
    if (typeof own?.['login'] === 'string' && typeof own['password'] === 'string') {
      return { login: own['login'], password: own['password'] }
    }
    return this.aim.storedCredentials(userId)
  }

  private async login(userId: string): Promise<string> {
    const credentials = await this.credentials(userId)
    if (!credentials) throw new GoMafiaLoginRequired()
    const result = await this.gateway.login(credentials.login, credentials.password)
    if (!result.ok) {
      if (typeof result.error === 'string' && TRANSPORT_ERRORS.has(result.error)) throw new GoMafiaUnavailable()
      throw new GoMafiaLoginRequired()
    }
    if (!result.cookie) throw new GoMafiaUnavailable()
    this.cookies.set(userId, result.cookie)
    return result.cookie
  }
}

/** Ошибки входа в GoMafia → ответ приложению; остальные ошибки пробрасываются. */
export function gomafiaFailure(c: Context, error: unknown) {
  if (error instanceof GoMafiaLoginRequired) {
    return fail(c, 409, 'gomafia_relogin_required', 'GoMafia теперь пускает только после входа — войдите в GoMafia ещё раз в профиле')
  }
  if (error instanceof GoMafiaUnavailable) return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отвечает, попробуйте позже')
  throw error
}
