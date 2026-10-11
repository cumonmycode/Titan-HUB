'use client'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/manage/DesignSystem'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/store/auth.store'

const LBL: React.CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'var(--on-surface-variant)',
  margin: '0 0 6px',
  display: 'block',
}

const VAL: React.CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 13,
  color: 'var(--on-surface)',
  margin: 0,
}

const CARD: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 16,
  padding: '20px 24px',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

const CARD_INNER: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: '14px 18px',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
}

interface SystemInfo {
  version: string
  shift: { id: string } | null
  eveningName?: string | null
  env?: string
}

// Версия приложения = версия активного Service Worker. Читаем из имён его кэшей
// (titan-static-vNNN / titan-runtime-vNNN), это отражает реально установленную на
// устройстве версию.
function useServiceWorkerVersion(): string | null {
  const [v, setV] = useState<string | null>(null)
  useEffect(() => {
    if (typeof caches === 'undefined') return
    let active = true
    caches.keys().then((keys) => {
      if (!active) return
      const k = keys.find((k) => /^titan-(static|runtime)-/.test(k))
      if (k) setV(k.replace(/^titan-(static|runtime)-/, ''))
    }).catch(() => { /* нет доступа к caches */ })
    return () => { active = false }
  }, [])
  return v
}

// ─── Резервное копирование ───────────────────────────────────────────────────
interface BackupEntry { name: string; size: number; at: string; location: 'drive' | 'local' }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}
function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '—' }
}

type RestorePick = { kind: 'named'; entry: BackupEntry } | { kind: 'upload'; file: File }

function BackupSection() {
  const qc = useQueryClient()
  const { show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [pick, setPick] = useState<RestorePick | null>(null)

  const { data: status, error: statusError } = useQuery({
    queryKey: ['system', 'backup', 'status'],
    queryFn: () => api.get<{ last: BackupEntry | null; driveConfigured: boolean }>('/system/backup/status'),
    // 403 = клуб-поддомен (бэкапы только на основном домене) — повторять бессмысленно.
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  })
  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['system', 'backups'],
    queryFn: () => api.get<{ entries: BackupEntry[]; driveConfigured: boolean }>('/system/backups'),
    enabled: restoreOpen,
  })

  const create = useMutation({
    mutationFn: () => api.post<{ name: string; uploaded: boolean }>('/system/backup', {}),
    onSuccess: (r) => {
      show(r.uploaded ? 'Копия создана и отправлена в Google Drive ☁️' : 'Копия создана (локально на сервере)', 'success')
      qc.invalidateQueries({ queryKey: ['system', 'backup', 'status'] })
      qc.invalidateQueries({ queryKey: ['system', 'backups'] })
    },
    onError: (e: any) => show(e?.message ?? 'Не удалось создать копию', 'error'),
  })

  const restore = useMutation({
    mutationFn: async (p: RestorePick) => {
      if (p.kind === 'named') {
        // confirm: true — пользователь уже подтвердил в диалоге «Заменить текущую базу?»;
        // без него API отвечает 400 (z.literal(true) в /system/restore).
        return api.post<{ ok: boolean; safetyBackup: string }>('/system/restore', { name: p.entry.name, source: p.entry.location, confirm: true })
      }
      // upload — multipart, через сырой fetch (api-клиент шлёт только JSON)
      const token = useAuthStore.getState().token
      const base = process.env.NEXT_PUBLIC_API_URL ?? '/api'
      // confirm=true — поле формы, без него /system/restore-upload отвечает 400
      // (подтверждение пользователь уже дал в диалоге выше).
      const fd = new FormData(); fd.append('file', p.file); fd.append('confirm', 'true')
      const res = await fetch(`${base}/system/restore-upload`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Ошибка восстановления')
      return res.json()
    },
    onSuccess: (r: any) => {
      show(`База восстановлена. Страховочная копия: ${r?.safetyBackup ?? '—'}. Обновите страницу.`, 'success')
      setPick(null); setRestoreOpen(false)
      qc.invalidateQueries()
    },
    onError: (e: any) => { show(e?.message ?? 'Не удалось восстановить', 'error'); setPick(null) },
  })

  // На клуб-поддомене бэкап/восстановление недоступны (API → 403) — блок не показываем.
  if (statusError instanceof ApiError && statusError.status === 403) return null

  const driveOn = status?.driveConfigured ?? false
  const last = status?.last ?? null
  const entries = list?.entries ?? []

  return (
    <div style={{ ...CARD, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icon name="backup" size={20} color="#10B981" />
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--on-surface)' }}>Резервное копирование</span>
      </div>

      {/* Последняя копия + статус Drive */}
      <div style={{ ...CARD_INNER, marginBottom: 12 }}>
        <span style={LBL}>Последняя копия</span>
        <p style={{ ...VAL, fontSize: 14 }}>{fmtDateTime(last?.at)}{last ? `  ·  ${fmtBytes(last.size)}` : ''}</p>
        <p style={{ fontSize: 11, margin: '8px 0 0', color: driveOn ? '#34D399' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name={driveOn ? 'cloud_done' : 'cloud_off'} size={14} />
          {driveOn ? 'Google Drive подключён' : 'Google Drive не подключён — копии только локально на сервере'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => create.mutate()} disabled={create.isPending}
          style={{ flex: 1, minWidth: 150, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 12, border: 'none', cursor: create.isPending ? 'default' : 'pointer', background: 'linear-gradient(135deg,#10B981,#4cd7f6)', color: '#fff', fontSize: 14, fontWeight: 700, opacity: create.isPending ? 0.7 : 1 }}>
          <Icon name={create.isPending ? 'refresh' : 'cloud_upload'} size={18} style={create.isPending ? { animation: 'spin 1s linear infinite' } : undefined} />
          {create.isPending ? 'Создаём…' : 'Создать копию'}
        </button>
        <button onClick={() => setRestoreOpen(true)}
          style={{ flex: 1, minWidth: 150, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', borderRadius: 12, border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer', background: 'rgba(245,158,11,0.08)', color: '#fbbf24', fontSize: 14, fontWeight: 700 }}>
          <Icon name="restore" size={18} /> Восстановить
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Модалка восстановления */}
      {restoreOpen && createPortal((
        <div onClick={(e) => { if (e.target === e.currentTarget && !restore.isPending) { setRestoreOpen(false); setPick(null) } }}
          style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 560, maxHeight: '85dvh', overflowY: 'auto', borderRadius: '24px 24px 0 0', padding: '24px 20px 40px', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -8px 40px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Восстановление</h2>
              <button onClick={() => { setRestoreOpen(false); setPick(null) }} disabled={restore.isPending} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={18} /></button>
            </div>
            <p style={{ fontSize: 12.5, color: '#fbbf24', margin: '0 0 16px', display: 'flex', gap: 6, lineHeight: 1.45 }}>
              <Icon name="warning" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              Восстановление ПОЛНОСТЬЮ заменит текущую базу. Перед заменой автоматически создаётся страховочная копия.
            </p>

            {/* Загрузка локального файла */}
            <input ref={fileRef} type="file" accept=".gz,.sql,.sql.gz,application/gzip" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setPick({ kind: 'upload', file: f }); e.currentTarget.value = '' }} />
            <button onClick={() => fileRef.current?.click()} disabled={restore.isPending}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.03)', color: 'var(--on-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: 16 }}>
              <Icon name="upload_file" size={18} /> Загрузить файл с устройства (.sql.gz)
            </button>

            <p style={LBL}>{driveOn ? 'Копии в Google Drive' : 'Локальные копии на сервере'}</p>
            {listLoading ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--on-surface-variant)' }}><Icon name="refresh" size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>
            ) : entries.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center', padding: 16 }}>Копий пока нет</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entries.map((e) => (
                  <div key={e.name} style={{ ...CARD_INNER, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                    <Icon name={e.location === 'drive' ? 'cloud' : 'storage'} size={18} color="var(--on-surface-variant)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</p>
                      <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{fmtDateTime(e.at)} · {fmtBytes(e.size)}</p>
                    </div>
                    <button onClick={() => setPick({ kind: 'named', entry: e })} disabled={restore.isPending}
                      style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.1)', color: '#fbbf24', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Восстановить</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ), document.body)}

      {/* Подтверждение восстановления */}
      {pick && createPortal((
        <div style={{ position: 'fixed', inset: 0, zIndex: 4001, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: '100%', maxWidth: 380, borderRadius: 20, padding: 24, textAlign: 'center', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.55)' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(244,63,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Icon name="warning" size={28} color="#f43f5e" />
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 8px' }}>Заменить текущую базу?</h3>
            <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '0 0 6px', lineHeight: 1.5 }}>
              {pick.kind === 'named' ? `Из копии «${pick.entry.name}».` : `Из файла «${pick.file.name}».`}
            </p>
            <p style={{ fontSize: 12, color: '#fbbf24', margin: '0 0 20px' }}>Текущие данные будут заменены. Сначала создастся страховочный бэкап.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPick(null)} disabled={restore.isPending} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'var(--on-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
              <button onClick={() => restore.mutate(pick)} disabled={restore.isPending} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#f43f5e', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: restore.isPending ? 0.7 : 1 }}>
                {restore.isPending ? 'Восстановление…' : 'Восстановить'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

export default function AboutPage() {
  const { data, isLoading, isError } = useQuery<SystemInfo>({
    queryKey: ['system', 'info'],
    queryFn: () => api.get<SystemInfo>('/system/info'),
    refetchInterval: false,
  })
  const swVersion = useServiceWorkerVersion()
  const info = data
  const [refreshing, setRefreshing] = useState(false)

  // «Обновить» — проверяем наличие новой версии Service Worker и перезагружаем
  // страницу, чтобы устройство подхватило свежую сборку. SW при install делает
  // skipWaiting + clients.claim, поэтому новый воркер активируется сразу, а
  // network-first HTML и новые хэшированные ассеты подтянутся при reload.
  const hardRefresh = async () => {
    setRefreshing(true)
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        if (reg) {
          await reg.update().catch(() => { /* офлайн/нет обновления */ })
          // Если новый воркер «ждёт» — просим активироваться немедленно.
          reg.waiting?.postMessage?.({ type: 'SKIP_WAITING' })
        }
      }
    } catch { /* ignore */ }
    // Небольшая пауза, чтобы проверка обновления успела стартовать, затем reload.
    setTimeout(() => { window.location.reload() }, 350)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PageHeader title="О системе" subtitle="Информация о версии и состоянии системы" />
      <div style={{ padding: '20px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%' }}>

        {/* Версия приложения */}
        <div style={{ ...CARD, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Icon name="info" size={20} color="#8B5CF6" />
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--on-surface)' }}>
              О приложении
            </span>
          </div>

          {isLoading && (
            <div style={{ color: 'var(--on-surface-variant)', fontSize: 13 }}>Загрузка...</div>
          )}
          {isError && (
            <div style={{ color: '#f87171', fontSize: 13 }}>Ошибка загрузки данных</div>
          )}

          {info && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {/* Окружение */}
              <div style={CARD_INNER}>
                <span style={LBL}>Окружение</span>
                <p style={VAL}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: info.env === 'production' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)',
                    color: info.env === 'production' ? '#4ade80' : '#fbbf24',
                    border: `1px solid ${info.env === 'production' ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)'}`,
                  }}>
                    {info.env ?? 'development'}
                  </span>
                </p>
              </div>

              {/* Смена + название вечера */}
              <div style={CARD_INNER}>
                <span style={LBL}>Смена</span>
                <p style={{ ...VAL, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: info.shift ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                    color: info.shift ? '#4ade80' : 'var(--on-surface-variant)',
                    border: `1px solid ${info.shift ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                    {info.shift ? 'Открыта' : 'Закрыта'}
                  </span>
                  {info.shift && info.eveningName && (
                    <span style={{ color: 'var(--on-surface)' }}>{info.eveningName}</span>
                  )}
                </p>
              </div>

              {/* Версия приложения (Service Worker) */}
              <div style={CARD_INNER}>
                <span style={LBL}>Версия приложения</span>
                <p style={{ ...VAL, fontSize: 18, fontWeight: 700, color: '#8B5CF6' }}>
                  {swVersion ?? '—'}
                </p>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button
              onClick={hardRefresh}
              disabled={refreshing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12,
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--on-surface)', fontSize: 13, fontWeight: 600,
                cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1, transition: 'all 0.2s',
              }}
            >
              <Icon name="refresh" size={16} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
              {refreshing ? 'Обновляем…' : 'Обновить'}
            </button>
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '8px 0 0' }}>
              Перезагружает приложение и подтягивает новую версию, если она вышла.
            </p>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Резервное копирование */}
        <BackupSection />

        {/* Документы */}
        <div style={{ ...CARD, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Icon name="description" size={20} color="#a78bfa" />
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--on-surface)' }}>
              Документы
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a
              href="https://titanpos.ru/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...CARD_INNER, display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="privacy_tip" size={18} color="#a78bfa" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--on-surface)' }}>Политика конфиденциальности</p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>titanpos.ru/privacy</p>
              </div>
              <Icon name="open_in_new" size={18} color="var(--on-surface-variant)" />
            </a>

            <a
              href="https://titanpos.ru/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...CARD_INNER, display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(76,215,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(76,215,246,0.3)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(76,215,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="gavel" size={18} color="#4cd7f6" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--on-surface)' }}>Пользовательское соглашение</p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>titanpos.ru/terms</p>
              </div>
              <Icon name="open_in_new" size={18} color="var(--on-surface-variant)" />
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
