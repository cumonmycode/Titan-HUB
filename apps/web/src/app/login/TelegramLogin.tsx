'use client'
/**
 * Первый вход в Titan HUB — через Tai в Telegram: ссылка открывает бота, сотрудник
 * жмёт «Войти», страница ждёт подтверждения. На компьютере — QR для телефона.
 * Дальше вход на этом устройстве — по passkey (Face ID / Touch ID) или PIN.
 */
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Icon } from '@/components/Icon'

const POLL_MS = 2000

type Start = { ticket: string; deepLink: string; qr: string; expiresAt: string }
type Status =
  | { status: 'pending'; opened: boolean }
  | { status: 'ok'; token: string; user: any; hasPin: boolean }
  | { status: 'rejected'; note?: string | null }
  | { status: 'expired' }

type Phase = 'idle' | 'starting' | 'waiting' | 'done'

function deviceName(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'компьютер'
  return `Браузер · ${os}`
}

export function TelegramLogin({ onSuccess, onPasskey }: {
  onSuccess: (token: string, user: any, hasPin: boolean) => void
  onPasskey?: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [start, setStart] = useState<Start | null>(null)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function poll(ticket: string) {
    try {
      const r = await api.get<Status>(`/auth/hub/status?ticket=${ticket}`)
      if (r.status === 'ok') {
        setPhase('done')
        onSuccess(r.token, r.user, r.hasPin)
        return
      }
      if (r.status === 'rejected') {
        setPhase('idle')
        setError(r.note || 'Вход отклонён в Telegram')
        return
      }
      if (r.status === 'expired') {
        setPhase('idle')
        setError('Ссылка устарела — нажмите «Войти через Telegram» ещё раз')
        return
      }
      setOpened(r.opened)
    } catch { /* сеть моргнула — пробуем дальше */ }
    timer.current = setTimeout(() => void poll(ticket), POLL_MS)
  }

  async function begin() {
    if (phase === 'starting' || phase === 'waiting') return
    setPhase('starting')
    setError('')
    setOpened(false)
    try {
      const s = await api.post<Start>('/auth/hub/start', { platform: 'web', deviceName: deviceName() })
      setStart(s)
      setPhase('waiting')
      window.open(s.deepLink, '_blank', 'noopener,noreferrer')
      timer.current = setTimeout(() => void poll(s.ticket), POLL_MS)
    } catch (e) {
      setPhase('idle')
      setError(e instanceof ApiError ? e.message : 'Не удалось начать вход')
    }
  }

  const waiting = phase === 'waiting' && start
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: '0 0 6px', textAlign: 'center' }}>
        Вход в систему
      </p>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 24px', textAlign: 'center', lineHeight: 1.5 }}>
        {waiting ? (opened ? 'Нажмите «Войти» в Telegram — и вернитесь сюда' : 'Откройте Tai в Telegram и подтвердите вход') : 'Подтвердите вход в Telegram — у бота клуба Tai'}
      </p>

      {waiting ? (
        <>
          <div style={{ padding: 12, borderRadius: 20, background: '#fff', marginBottom: 14 }}>
            <img src={start.qr} alt="QR-код для входа через Telegram" width={180} height={180} style={{ display: 'block' }} />
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px', textAlign: 'center' }}>
            С компьютера — наведите камеру телефона на код
          </p>
          <a href={start.deepLink} target="_blank" rel="noopener noreferrer"
            style={{ width: '100%', boxSizing: 'border-box', padding: 14, borderRadius: 14, background: '#2AABEE', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="send" size={18} /> Открыть Telegram
          </a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            <span className="tg-wait-dot" /> Ждём подтверждения…
          </div>
        </>
      ) : (
        <button type="button" onClick={() => void begin()} disabled={phase === 'starting'}
          style={{ width: '100%', padding: 16, borderRadius: 16, border: 'none', background: '#2AABEE', color: '#fff', fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: phase === 'starting' ? 0.7 : 1 }}>
          <Icon name="send" size={20} /> {phase === 'starting' ? 'Открываем…' : 'Войти через Telegram'}
        </button>
      )}

      {error && (
        <div style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5', fontSize: 13, marginTop: 14, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {onPasskey && (
        <button type="button" onClick={onPasskey}
          style={{ marginTop: 18, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)', fontSize: 13, padding: 6 }}>
          На этом устройстве уже есть passkey — войти по Face ID / Touch ID
        </button>
      )}

      <style>{`
        .tg-wait-dot { width: 8px; height: 8px; border-radius: 50%; background: #2AABEE; animation: tg-wait 1.2s ease-in-out infinite; }
        @keyframes tg-wait { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .tg-wait-dot { animation: none; } }
      `}</style>
    </div>
  )
}
