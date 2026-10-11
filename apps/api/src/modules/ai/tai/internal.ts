/**
 * Вызовы API кассы и аналитики изнутри Tai — от имени того же сотрудника.
 *
 * Tai не ходит в базу в обход экранов: каждое чтение и каждое действие — это тот же
 * HTTP-маршрут, что вызывает приложение, с тем же токеном и хостом клуба. Поэтому
 * права (роль, permissions сотрудника), проверки смены и суммы, уведомления и
 * обновление кассы в реальном времени работают ровно как при нажатии кнопки.
 */
import type { Context } from 'hono'
import type { AppEnv } from '../../../types.js'

export class InternalApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type AppFetch = (request: Request) => Response | Promise<Response>
let appFetch: AppFetch | null = null

// app.ts импортирует роутер ИИ, поэтому само приложение берём лениво — без цикла
// импортов на старте.
async function getAppFetch(): Promise<AppFetch> {
  if (!appFetch) {
    const { app } = await import('../../../app.js')
    appFetch = (request) => app.fetch(request)
  }
  return appFetch
}

// Заголовки, без которых маршрут поведёт себя иначе: токен, клуб (по Host), IP для
// лимитов и журнала, платформа клиента.
const FORWARDED = ['authorization', 'host', 'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-app-platform', 'x-app-version', 'user-agent']

function errorText(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string') return error
    const issues = (error as { issues?: { message?: string }[] } | undefined)?.issues
    if (issues?.[0]?.message) return issues[0].message
  }
  return `Ошибка ${status}`
}

export interface ApiCaller {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}

/** Заголовки исходного запроса, чтобы выполнить действие позже (подтверждение карточки). */
export function forwardedHeaders(c: Context<AppEnv>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARDED) {
    const value = c.req.header(name)
    if (value) headers[name] = value
  }
  return headers
}

export function createApiCaller(headers: Record<string, string>): ApiCaller {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    if (!path.startsWith('/api/')) throw new Error(`internal path must start with /api/: ${path}`)
    const fetcher = await getAppFetch()
    const request = new Request(`http://internal${path}`, {
      method,
      headers: { ...headers, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const response = await fetcher(request)
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!response.ok) throw new InternalApiError(response.status, errorText(response.status, parsed))
    return parsed as T
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
    patch: (path, body) => call('PATCH', path, body ?? {}),
    delete: (path) => call('DELETE', path),
  }
}
