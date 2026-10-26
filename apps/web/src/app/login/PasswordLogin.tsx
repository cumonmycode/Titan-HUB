'use client'
// Вход в кассу по логину и паролю — для учётных записей без Telegram (проверяющие
// эквайера, App Review). Логин — никнейм сотрудника. Сервер (/auth/login/password)
// ограничивает попытки и отвечает одинаково на неверный логин и неверный пароль.
import { useState } from 'react'
import { api, ApiError } from '@/lib/api'

interface PasswordLoginResult {
  token: string
  user: unknown
  needsPinSetup: boolean
  hasPasskey: boolean
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
  color: '#fff', fontSize: 16, outline: 'none',
}

export function PasswordLogin({
  onSuccess,
  onBack,
}: {
  onSuccess: (token: string, user: any, opts: { needsPinSetup: boolean; hasPasskey: boolean }) => void
  onBack: () => void
}) {
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!nickname.trim() || !password) { setError('Введите логин и пароль'); return }
    setLoading(true)
    setError('')
    try {
      const r = await api.post<PasswordLoginResult>('/auth/login/password', { nickname: nickname.trim(), password })
      onSuccess(r.token, r.user, { needsPinSetup: r.needsPinSetup, hasPasskey: r.hasPasskey })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: '0 0 6px', textAlign: 'center' }}>
        Вход по логину и паролю
      </p>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 24px', textAlign: 'center', lineHeight: 1.5 }}>
        Для учётных записей, выданных администратором клуба
      </p>

      <input
        style={{ ...inputStyle, marginBottom: 10 }}
        value={nickname}
        onChange={(e) => { setNickname(e.target.value); setError('') }}
        placeholder="Логин"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Логин"
      />
      <input
        style={inputStyle}
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setError('') }}
        placeholder="Пароль"
        autoComplete="current-password"
        aria-label="Пароль"
      />

      <button type="submit" disabled={loading}
        style={{ width: '100%', marginTop: 16, padding: 16, borderRadius: 16, border: 'none', background: '#8B5CF6', color: '#fff', fontWeight: 800, fontSize: 16, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
        {loading ? 'Входим…' : 'Войти'}
      </button>

      {error && (
        <div role="alert" style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5', fontSize: 13, marginTop: 14, textAlign: 'center' }}>
          {error}
        </div>
      )}

      <button type="button" onClick={onBack}
        style={{ marginTop: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 13, padding: 6 }}>
        Войти через Telegram
      </button>
    </form>
  )
}
