'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'
import { api, ApiError } from '@/lib/api'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { Icon } from '@/components/Icon'
import { TelegramLogin } from './TelegramLogin'

// ─── Screen types ─────────────────────────────────────────────────────────────

type Screen =
  | 'telegram'      // Первый вход на устройстве — подтверждение у Tai в Telegram
  | 'passkey'       // Повторный вход на устройстве с passkey (Face ID / Touch ID)
  | 'pin-setup'     // Set PIN after first login
  | 'passkey-setup' // Offer passkey registration

function isWebAuthnSupported() {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()
  const { setAuth, token, user, _hasHydrated } = useAuthStore()

  useEffect(() => {
    if (!_hasHydrated) return
    if (token) router.replace(user?.role === 'tablet' ? '/tablet' : '/pos')
  }, [token, user, _hasHydrated, router])

  const [webAuthnSupported] = useState(isWebAuthnSupported)
  const [screen, setScreen] = useState<Screen>('telegram')
  const [pendingAuth, setPendingAuth] = useState<{ token: string; user: any } | null>(null)

  function afterLogin(token: string, user: any, opts?: { needsPinSetup?: boolean; hasPasskey?: boolean }) {
    const hp = opts?.hasPasskey ?? false
    setPendingAuth({ token, user })

    if (opts?.needsPinSetup) {
      // No PIN yet → offer PIN setup, then passkey
      setScreen('pin-setup')
    } else if (!hp && webAuthnSupported) {
      // Has PIN but no passkey → offer passkey registration
      setScreen('passkey-setup')
    } else {
      // Fully set up → go to app
      setAuth(token, user)
      router.replace(user?.role === 'tablet' ? '/tablet' : '/pos')
    }
  }

  function afterPinSetup(hasPasskey: boolean) {
    if (!pendingAuth) return
    if (!hasPasskey && webAuthnSupported) {
      setScreen('passkey-setup')
    } else {
      finishSetup()
    }
  }

  function finishSetup() {
    if (!pendingAuth) return
    setAuth(pendingAuth.token, pendingAuth.user)
    router.replace(pendingAuth.user?.role === 'tablet' ? '/tablet' : '/pos')
  }

  // Setup screens
  if (screen === 'pin-setup') {
    return <PinSetupScreen pendingAuth={pendingAuth!} onDone={afterPinSetup} onSkip={() => afterPinSetup(false)} />
  }
  if (screen === 'passkey-setup') {
    return <PasskeySetupScreen pendingAuth={pendingAuth!} onDone={finishSetup} onSkip={finishSetup} />
  }

  // Login screens
  return (
    <LoginLayout>
      {screen === 'telegram' && (
        <TelegramLogin
          onSuccess={(token, user, hasPin) => afterLogin(token, user, { needsPinSetup: !hasPin, hasPasskey: false })}
          onPasskey={webAuthnSupported ? () => setScreen('passkey') : undefined}
        />
      )}
      {screen === 'passkey' && (
        <PasskeyScreen
          onSuccess={(token, user) => afterLogin(token, user, { needsPinSetup: false, hasPasskey: true })}
          onTelegram={() => setScreen('telegram')}
        />
      )}
    </LoginLayout>
  )
}

// ─── Layout wrapper ───────────────────────────────────────────────────────────

function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(139,92,246,0.18) 0%, transparent 70%), #0b0912',
      padding: '20px 16px',
    }}>
      {/* Ambient */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '20%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(139,92,246,0.08)', filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(76,215,246,0.06)', filter: 'blur(80px)' }} />
      </div>

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 60, height: 60, borderRadius: 18, marginBottom: 14,
            background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
            boxShadow: '0 0 40px rgba(139,92,246,0.4)',
          }}>
            <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
              <path d="M16 3L29 10.5V21.5L16 29L3 21.5V10.5L16 3Z" stroke="white" strokeWidth="2" fill="rgba(255,255,255,0.12)" />
              <path d="M16 9L23 13.5V20.5L16 25L9 20.5V13.5L16 9Z" fill="rgba(255,255,255,0.28)" />
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px', background: 'linear-gradient(135deg, #A78BFA, #4cd7f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TITAN HUB
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: 0 }}>Система управления заведением</p>
        </div>

        {/* Card */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 28, padding: '32px 28px', backdropFilter: 'blur(20px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}>
          {children}
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.06em' }}>
          TITAN HUB · v2.0
        </p>
      </div>
    </div>
  )
}

// ─── Passkey Screen (повторный вход на устройстве) ───────────────────────────

function PasskeyScreen({
  onSuccess,
  onTelegram,
}: {
  onSuccess: (token: string, user: any) => void
  onTelegram: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const triggered = useRef(false)

  async function authenticate() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const { options, challengeId } = await api.post<{ options: any; challengeId: string }>(
        '/auth/passkey/authenticate/options', {}
      )
      const response = await startAuthentication({ optionsJSON: options })
      const res = await api.post<{ token: string; user: any }>(
        '/auth/passkey/authenticate/verify', { challengeId, response }
      )
      onSuccess(res.token, res.user)
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') {
        setError('')
      } else if (e instanceof ApiError && e.status === 404) {
        setError('Passkey не найден на этом устройстве')
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка входа')
      }
    } finally {
      setLoading(false)
    }
  }

  // Auto-trigger on mount
  useEffect(() => {
    if (triggered.current) return
    triggered.current = true
    const t = setTimeout(authenticate, 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: '0 0 6px', textAlign: 'center' }}>
        Вход в систему
      </p>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 32px', textAlign: 'center' }}>
        Используйте биометрию или ключ безопасности
      </p>

      {/* Big passkey button */}
      <button
        onClick={authenticate}
        disabled={loading}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          width: '100%', padding: '28px 20px', borderRadius: 20,
          border: `1px solid ${loading ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
          background: loading ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.05)',
          cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s', marginBottom: 12,
        }}
        onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = 'rgba(139,92,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)' } }}
        onMouseLeave={e => { if (!loading) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' } }}
      >
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(76,215,246,0.1))',
          border: `1px solid rgba(139,92,246,${loading ? '0.6' : '0.3'})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: loading ? '0 0 24px rgba(139,92,246,0.3)' : 'none',
          animation: loading ? 'pk-pulse 1.5s ease-in-out infinite' : 'none',
        }}>
          <PasskeyIcon size={36} color={loading ? '#A78BFA' : 'rgba(255,255,255,0.6)'} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 2 }}>
            {loading ? 'Ожидание...' : 'Войти с Passkey'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            Face ID · Touch ID · Ключ безопасности
          </div>
        </div>
      </button>

      {error && (
        <div style={{ width: '100%', padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', margin: '4px 0 16px' }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>или</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
      </div>

      {/* Первый вход на этом устройстве — через Telegram */}
      <button
        onClick={onTelegram}
        style={{
          width: '100%', padding: '13px', borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
          color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
      >
        <Icon name="send" size={18} />
        Войти через Telegram
      </button>

      <style>{`
        @keyframes pk-pulse {
          0%, 100% { box-shadow: 0 0 20px rgba(139,92,246,0.2); }
          50% { box-shadow: 0 0 40px rgba(139,92,246,0.5); }
        }
      `}</style>
    </div>
  )
}

// ─── PIN Setup Screen ─────────────────────────────────────────────────────────

function PinSetupScreen({
  pendingAuth,
  onDone,
  onSkip,
}: {
  pendingAuth: { token: string; user: any }
  onDone: (hasPasskey: boolean) => void
  onSkip: () => void
}) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  function handleInput(v: string) {
    setError(false)
    if (step === 'enter') {
      setPin(v)
      if (v.length === 4) setTimeout(() => setStep('confirm'), 200)
    } else {
      setConfirm(v)
      if (v.length === 4) {
        setTimeout(async () => {
          if (v !== pin) {
            setError(true)
            setTimeout(() => { setPin(''); setConfirm(''); setStep('enter'); setError(false) }, 700)
            return
          }
          setLoading(true)
          try {
            useAuthStore.setState({ token: pendingAuth.token })
            await api.post('/auth/pin/set', { pin })
            onDone(false) // No passkey yet
          } catch {
            setError(true)
          } finally {
            setLoading(false)
          }
        }, 200)
      }
    }
  }

  const displayPin = step === 'enter' ? pin : confirm

  return (
    <SetupLayout icon="pin" title="Установите PIN" subtitle="4-значный PIN для быстрого входа после блокировки" step={1} totalSteps={2}>
      <PinDots value={displayPin} error={error} />
      <PinPad onChange={handleInput} value={displayPin} loading={loading} />
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', margin: '4px 0 0' }}>
        {step === 'enter' ? 'Придумайте PIN' : 'Повторите PIN'}
      </p>
      {error && step === 'confirm' && <p style={{ fontSize: 12, color: '#FCA5A5', textAlign: 'center', margin: '4px 0 0' }}>PIN-коды не совпадают</p>}
      <SkipBtn label="Пропустить" onClick={onSkip} />
    </SetupLayout>
  )
}

// ─── Passkey Setup Screen ─────────────────────────────────────────────────────

function PasskeySetupScreen({
  pendingAuth,
  onDone,
  onSkip,
}: {
  pendingAuth: { token: string; user: any }
  onDone: () => void
  onSkip: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function register() {
    setLoading(true)
    setError('')
    try {
      useAuthStore.setState({ token: pendingAuth.token })
      const options = await api.post<any>('/auth/passkey/register/options', {})
      const response = await startRegistration({ optionsJSON: options })
      await api.post('/auth/passkey/register/verify', response)
      setDone(true)
      setTimeout(onDone, 1200)
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') { setLoading(false); return }
      setError(e instanceof ApiError ? e.message : 'Ошибка регистрации')
      setLoading(false)
    }
  }

  return (
    <SetupLayout icon="fingerprint" title="Добавить биометрию" subtitle="Face ID, Touch ID или ключ безопасности — без пароля" step={2} totalSteps={2}>
      {done ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px', background: 'rgba(16,185,129,0.15)', border: '2px solid #10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check_circle" size={34} color="#10B981" />
          </div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#10B981', margin: 0 }}>Passkey добавлен!</p>
        </div>
      ) : (
        <>
          <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 88, height: 88, borderRadius: 24, background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(76,215,246,0.1))', border: '1px solid rgba(139,92,246,0.25)' }}>
              <PasskeyIcon size={44} color="#A78BFA" />
            </div>
          </div>
          {error && <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
          <button onClick={register} disabled={loading}
            style={{
              width: '100%', padding: '15px', borderRadius: 16, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontWeight: 700, fontSize: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: '0 4px 24px rgba(139,92,246,0.35)', opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s',
            }}
          >
            <Icon name="fingerprint" size={22} />
            {loading ? 'Регистрация...' : 'Добавить Passkey'}
          </button>
          <SkipBtn label="Пропустить — войти в систему" onClick={onSkip} />
        </>
      )}
    </SetupLayout>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SetupLayout({ icon, title, subtitle, step, totalSteps, children }: {
  icon: string; title: string; subtitle: string; step: number; totalSteps: number; children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(139,92,246,0.15) 0%, transparent 70%), #0b0912', padding: '20px 16px' }}>
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '20%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(139,92,246,0.07)', filter: 'blur(80px)' }} />
      </div>
      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{ width: i + 1 === step ? 24 : 8, height: 8, borderRadius: 4, background: i + 1 <= step ? 'linear-gradient(135deg, #8B5CF6, #4cd7f6)' : 'rgba(255,255,255,0.12)', transition: 'all 0.3s' }} />
          ))}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 28, padding: '32px 26px', backdropFilter: 'blur(20px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 14, marginBottom: 14, background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(76,215,246,0.1))', border: '1px solid rgba(139,92,246,0.3)' }}>
              <Icon name={icon} size={26} color="#A78BFA" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.95)', margin: '0 0 6px' }}>{title}</h2>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.5 }}>{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

function PinDots({ value, error }: { value: string; error: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginBottom: 24, animation: error ? 'pin-shake 0.35s ease' : 'none' }}>
      {[0,1,2,3].map(i => {
        const f = i < value.length
        return <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: f ? (error ? '#EF4444' : '#8B5CF6') : 'transparent', border: `2px solid ${f ? (error ? '#EF4444' : '#8B5CF6') : 'rgba(255,255,255,0.2)'}`, boxShadow: f && !error ? '0 0 14px rgba(139,92,246,0.7)' : 'none', transform: f ? 'scale(1.2)' : 'scale(1)', transition: 'all 0.15s' }} />
      })}
    </div>
  )
}

function PinPad({ onChange, value, loading }: { onChange: (v: string) => void; value: string; loading?: boolean }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫']
  function press(k: string) {
    if (loading) return
    if (k === '⌫') { onChange(value.slice(0, -1)); return }
    if (value.length >= 4) return
    onChange(value + k)
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
      {keys.map((k, i) => {
        if (k === '') return <div key={i} />
        const isDel = k === '⌫'
        return (
          <button key={i} onClick={() => press(k)} disabled={!!loading} aria-label={isDel ? 'Стереть' : k}
            style={{ aspectRatio: '1/1', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', background: isDel ? 'transparent' : 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.9)', fontSize: isDel ? 20 : 24, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.1s', opacity: loading ? 0.5 : 1 }}
            onMouseDown={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.2)'; e.currentTarget.style.transform = 'scale(0.92)' }}
            onMouseUp={e => { e.currentTarget.style.background = isDel ? 'transparent' : 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'scale(1)' }}
            onMouseLeave={e => { e.currentTarget.style.background = isDel ? 'transparent' : 'rgba(255,255,255,0.05)'; e.currentTarget.style.transform = 'scale(1)' }}
          >{k}</button>
        )
      })}
    </div>
  )
}

function SkipBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}
        onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
      >{label}</button>
    </div>
  )
}

function PasskeyIcon({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color }}>
      <circle cx="8" cy="9" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12.5 13.5L15 11L18 14L21 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 19.5C4 17.5 5.8 16 8 16s4 1.5 4 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
