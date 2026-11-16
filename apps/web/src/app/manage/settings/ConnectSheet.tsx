'use client'
/**
 * Titan Connect в веб-панели: свои подключения сторонних сервисов к данным клиентов.
 * Список сервисов → «Подключить сервис» (имя + права → одноразовый код) → карточка
 * сервиса (права меняются сразу, новый код, отключение). То же, что в приложении HUB.
 */
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { INP, LBL, Button, Sheet, Toggle, ConfirmDialog } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'

export interface ConnectScopeInfo { key: string; title: string; description: string; required: boolean }
export interface ConnectConnection {
  id: string; name: string; scopes: string[]; status: 'pending' | 'active'
  serviceName: string | null; serviceUrl: string | null; tokenPrefix: string | null
  codeExpiresAt: string | null; createdAt: string; connectedAt: string | null
  lastUsedAt: string | null; requestCount: number
}
export interface ConnectOverview { apiBase: string; scopes: ConnectScopeInfo[]; items: ConnectConnection[] }
type IssuedCode = { code: string; expiresAt: string }

export const CONNECT_QUERY = ['connect'] as const
const POLL_MS = 3000
const ACCENT = '#8B5CF6'

/** Пока у подключения живой код — опрашиваем, чтобы увидеть момент подключения сервиса. */
export function useConnectOverview() {
  return useQuery<ConnectOverview>({
    queryKey: CONNECT_QUERY,
    queryFn: () => api.get('/connect/manage'),
    refetchInterval: (q) => (q.state.data?.items.some(c => c.codeExpiresAt) ? POLL_MS : false),
  })
}

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
function ago(iso: string | null): string {
  if (!iso) return 'ещё не было'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  return DATE.format(new Date(iso))
}

type ShowToast = (message: string, type: 'success' | 'error') => void
async function copy(text: string, show: ShowToast, done = 'Скопировано') {
  try { await navigator.clipboard.writeText(text); show(done, 'success') } catch { show('Не удалось скопировать', 'error') }
}

const guide = (apiBase: string) => [
  'Titan Connect — API клиентов клуба',
  `1. POST ${apiBase}/exchange  {"code": "K7QM-3XPA", "service": {"name": "Ваш сервис"}} → accessToken (бессрочный) и apiBase.`,
  '2. Дальше заголовок Authorization: Bearer <accessToken>.',
  `   GET ${apiBase}/clients?search=ник · GET ${apiBase}/clients/<id> · GET ${apiBase}/me`,
  '3. Синхронизация: сохраните syncCursor и передавайте ?cursor=… — придут только изменения (удалённые с deleted: true).',
  '401 invalid_token — подключение отключили в Titan HUB, нужен новый код.',
].join('\n')

export function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data, isLoading, error } = useConnectOverview()
  const [view, setView] = useState<string>('list') // 'list' | 'new' | id подключения
  const [codes, setCodes] = useState<Record<string, IssuedCode>>({}) // код виден только в момент выдачи
  const [confirmDel, setConfirmDel] = useState<ConnectConnection | null>(null)

  useEffect(() => { if (!open) setView('list') }, [open])
  const refresh = () => qc.invalidateQueries({ queryKey: CONNECT_QUERY })
  const fail = (e: unknown) => show(e instanceof Error ? e.message : 'Не получилось', 'error')

  const create = useMutation({
    mutationFn: (body: { name: string; scopes: string[] }) => api.post<IssuedCode & { connection: ConnectConnection }>('/connect/manage/connections', body),
    onSuccess: (r) => { setCodes(c => ({ ...c, [r.connection.id]: { code: r.code, expiresAt: r.expiresAt } })); setView(r.connection.id); refresh() },
    onError: fail,
  })
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; scopes?: string[]; name?: string }) => api.patch(`/connect/manage/connections/${id}`, body),
    onSuccess: refresh, onError: fail,
  })
  const newCode = useMutation({
    mutationFn: (id: string) => api.post<IssuedCode>(`/connect/manage/connections/${id}/code`).then(code => ({ id, code })),
    onSuccess: ({ id, code }) => { setCodes(c => ({ ...c, [id]: code })); refresh() },
    onError: fail,
  })
  const cancelCode = useMutation({
    mutationFn: (id: string) => api.delete(`/connect/manage/connections/${id}/code`),
    onSuccess: refresh, onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/connect/manage/connections/${id}`),
    onSuccess: () => { refresh(); setConfirmDel(null); setView('list'); show('Сервис отключён', 'success') },
    onError: fail,
  })

  const current = data?.items.find(c => c.id === view) ?? null
  const title = view === 'new' ? 'Подключить сервис' : current ? current.name : 'Titan Connect'
  const liveCode = current && codes[current.id]?.expiresAt === current.codeExpiresAt ? codes[current.id] ?? null : null

  return (
    <Sheet open={open} onClose={onClose} title={title} desktopSize="md">
      {isLoading && !data ? <StateView state="loading" /> : error || !data ? <StateView state="error" description="Не удалось загрузить Titan Connect" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {view !== 'list' && (
            <button onClick={() => setView('list')} style={backBtn}><Icon name="chevron_left" size={16} /> Все сервисы</button>
          )}
          {view === 'list' && <ListView data={data} onOpen={setView} onNew={() => setView('new')} onCopyGuide={() => copy(guide(data.apiBase), show, 'Памятка скопирована')} />}
          {view === 'new' && <NewView scopes={data.scopes} busy={create.isPending} onCreate={(name, scopes) => create.mutate({ name, scopes })} />}
          {current && (
            <ConnectionView
              conn={current}
              scopes={data.scopes}
              code={liveCode}
              onScopes={(scopes) => patch.mutate({ id: current.id, scopes })}
              onNewCode={() => newCode.mutate(current.id)}
              onCancelCode={() => cancelCode.mutate(current.id)}
              onCopyCode={(code) => copy(code, show, 'Код скопирован')}
              onDisconnect={() => setConfirmDel(current)}
              busyCode={newCode.isPending}
            />
          )}
          {view !== 'list' && view !== 'new' && !current && <StateView state="empty" icon="link_off" title="Подключение не найдено" description="Его уже отключили." />}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && remove.mutate(confirmDel.id)}
        title={confirmDel ? `Отключить «${confirmDel.name}»?` : ''}
        message="Сервис сразу потеряет доступ к данным клиентов. Подключить снова можно только новым кодом."
        confirmLabel="Отключить"
        danger
        loading={remove.isPending}
      />
    </Sheet>
  )
}

function ListView({ data, onOpen, onNew, onCopyGuide }: { data: ConnectOverview; onOpen: (id: string) => void; onNew: () => void; onCopyGuide: () => void }) {
  return (
    <>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: 0, color: 'var(--on-surface)' }}>
        Сайт рейтинга, бот турниров, CRM — любой сервис получает ники, имена, фото и другие данные клиентов клуба.
        Подключение одноразовым кодом: сервис вводит его один раз и дальше работает сам, пока вы его не отключите.
      </p>
      {data.items.map(c => (
        <button key={c.id} onClick={() => onOpen(c.id)} className="glass-l2" style={rowBtn}>
          <Icon name={c.status === 'active' ? 'check_circle' : 'hourglass_top'} size={20} color={c.status === 'active' ? '#10B981' : '#F59E0B'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{c.name}</p>
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{summary(c)}</p>
          </div>
          <Icon name="chevron_right" size={18} color="var(--on-surface-variant)" />
        </button>
      ))}
      <Button variant="primary" fullWidth icon="add" onClick={onNew}>Подключить сервис</Button>
      <div style={infoBox}>
        <span style={{ ...LBL, margin: 0 }}>Для разработчика</span>
        <code style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--on-surface)' }}>{data.apiBase}</code>
        <Button variant="secondary" size="sm" icon="content_copy" onClick={onCopyGuide}>Скопировать памятку</Button>
      </div>
    </>
  )
}

function summary(c: ConnectConnection): string {
  if (c.status === 'pending') return c.codeExpiresAt ? 'Ждёт ввода кода' : 'Не подключено — нужен новый код'
  return `${c.serviceName ? `${c.serviceName} · ` : ''}запрос ${ago(c.lastUsedAt)}`
}

function ScopeList({ scopes, selected, onChange }: { scopes: ConnectScopeInfo[]; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {scopes.map(s => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{s.title}{s.required ? ' · всегда' : ''}</p>
            <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '2px 0 0', lineHeight: 1.4 }}>{s.description}</p>
          </div>
          <Toggle
            value={s.required || selected.includes(s.key)}
            ariaLabel={s.title}
            onChange={(v) => { if (!s.required) onChange(v ? [...selected, s.key] : selected.filter(k => k !== s.key)) }}
          />
        </div>
      ))}
    </div>
  )
}

function NewView({ scopes, busy, onCreate }: { scopes: ConnectScopeInfo[]; busy: boolean; onCreate: (name: string, scopes: string[]) => void }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>(['clients:read', 'clients:photos'])
  return (
    <>
      <div>
        <label style={LBL}>Название</label>
        <input style={INP} autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Например, «Сайт рейтинга»" />
      </div>
      <div>
        <span style={LBL}>Что увидит сервис</span>
        <ScopeList scopes={scopes} selected={selected} onChange={setSelected} />
        <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '10px 0 0' }}>Права можно поменять позже — переподключать сервис не придётся.</p>
      </div>
      <Button variant="primary" fullWidth icon="key" loading={busy} disabled={!name.trim()} onClick={() => onCreate(name.trim(), selected)}>Получить код</Button>
    </>
  )
}

interface ConnectionViewProps {
  conn: ConnectConnection
  scopes: ConnectScopeInfo[]
  code: IssuedCode | null
  onScopes: (s: string[]) => void
  onNewCode: () => void
  onCancelCode: () => void
  onCopyCode: (c: string) => void
  onDisconnect: () => void
  busyCode: boolean
}

function ConnectionView({ conn, scopes, code, onScopes, onNewCode, onCancelCode, onCopyCode, onDisconnect, busyCode }: ConnectionViewProps) {
  const active = conn.status === 'active'
  return (
    <>
      {conn.codeExpiresAt && (
        <div style={{ ...infoBox, alignItems: 'center', textAlign: 'center' }}>
          <span style={{ ...LBL, margin: 0 }}>Одноразовый код</span>
          {code ? (
            <>
              <button onClick={() => onCopyCode(code.code)} title="Скопировать" style={codeBtn}>{code.code}</button>
              <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>Действует до {TIME.format(new Date(code.expiresAt))} · вводится один раз · нажмите, чтобы скопировать</p>
            </>
          ) : (
            <p style={{ fontSize: 12.5, margin: 0, color: 'var(--on-surface-variant)' }}>Код виден только в момент выдачи — получите новый, чтобы его показать.</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {!code && <Button variant="secondary" size="sm" icon="key" loading={busyCode} onClick={onNewCode}>Показать новый код</Button>}
            <Button variant="secondary" size="sm" icon="close" onClick={onCancelCode}>Отменить код</Button>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: 0 }}>Окно само покажет, когда сервис подключится.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        <Line label="Состояние" value={active ? `Подключено ${ago(conn.connectedAt)}` : 'Ждёт ввода кода'} color={active ? '#10B981' : '#F59E0B'} />
        {conn.serviceName && <Line label="Сервис" value={conn.serviceName} />}
        {conn.serviceUrl && <Line label="Сайт" value={conn.serviceUrl.replace(/^https?:\/\//, '')} />}
        {active && <Line label="Последний запрос" value={ago(conn.lastUsedAt)} />}
        {active && <Line label="Запросов всего" value={conn.requestCount.toLocaleString('ru-RU')} />}
        {conn.tokenPrefix && <Line label="Ключ" value={`${conn.tokenPrefix}…`} mono />}
      </div>

      <div>
        <span style={LBL}>Что видит сервис</span>
        <ScopeList scopes={scopes} selected={conn.scopes} onChange={onScopes} />
        <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '10px 0 0' }}>Изменения действуют со следующего запроса сервиса.</p>
      </div>

      {!conn.codeExpiresAt && (
        <>
          <Button variant="secondary" fullWidth icon="key" loading={busyCode} onClick={onNewCode}>
            {active ? 'Переподключить новым кодом' : 'Получить новый код'}
          </Button>
          {active && <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '-8px 0 0' }}>Нужно, только если сервис потерял ключ: прежний перестанет работать, как только сервис введёт новый код.</p>}
        </>
      )}
      <button onClick={onDisconnect} style={dangerBtn}><Icon name="link_off" size={16} color="#F43F5E" /> Отключить сервис</button>
    </>
  )
}

function Line({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--on-surface-variant)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? 'var(--on-surface)', fontFamily: mono ? "'JetBrains Mono',monospace" : undefined, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

const backBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', fontSize: 13, padding: 0 }
const rowBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', borderRadius: 14, padding: '12px 14px', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'var(--on-surface)' }
const infoBox: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14, background: 'rgba(139,92,246,0.08)', border: `1px solid ${ACCENT}38` }
const codeBtn: React.CSSProperties = { fontFamily: "'JetBrains Mono',monospace", fontSize: 34, fontWeight: 800, letterSpacing: '0.12em', background: 'none', border: 'none', color: 'var(--on-surface)', cursor: 'copy', padding: '4px 0' }
const dangerBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: '#F43F5E', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
