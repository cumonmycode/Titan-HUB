'use client'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { PageHeader, Sheet, Button, IconButton, ConfirmDialog, Chip, INP, LBL } from '@/components/manage/DesignSystem'
import { ClientNotifySheet } from '@/components/manage/ClientNotifySheet'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'
import { telLink, openContact } from '@/lib/contact'
import { useRouter } from 'next/navigation'

const GM_TAG_RE = /^gomafia:\d+$/
// Скрытые «системные» теги (привязка GoMafia + ник GoMafia) — не показываем в поле
// «Теги» и сохраняем при правках, чтобы не потерять.
const MANAGED_TAG_RE = /^(gomafia:\d+|gmnick:)/
const gomafiaIdOf = (c: any): string | null => {
  const t = (Array.isArray(c?.searchTags) ? c.searchTags : []).find((x: string) => GM_TAG_RE.test(x))
  return t ? t.split(':')[1] : null
}
// Эффективное фото клиента по приоритету: ручное → Telegram → GoMafia.
const avatarOf = (c: any): string | null => c?.photoUrl || c?.tgPhotoUrl || c?.gomafiaPhotoUrl || null

const TIER_COLORS: Record<string, string> = {
  newbie: '#22D3EE', guest: 'rgba(204,195,216,0.6)', resident: '#8B5CF6', student: '#3B82F6',
  bronze: '#cd7f32', silver: '#94A3B8', gold: '#F59E0B', platinum: '#E2E8F0',
}
const TIER_LABELS: Record<string, string> = {
  newbie: 'Новичок', guest: 'Гость', resident: 'Резидент', student: 'Студент',
  bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина',
}

type TierRow = { key: string; label: string; color: string; sortOrder: number; isSystem: boolean }

function parseNum(v: unknown) { return parseFloat(String(v ?? 0)) || 0 }
function fmt(n: number) { return n.toLocaleString('ru', { maximumFractionDigits: 0 }) }
function pluralVisits(n: number) {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return 'посещений'
  if (b > 1 && b < 5) return 'посещения'
  if (b === 1) return 'посещение'
  return 'посещений'
}
// Кнопки ±1 «виртуальное» посещение (без влияния на кассу).
function VisitButtons({ onAdj, disabled }: { onAdj: (d: number) => void; disabled?: boolean }) {
  const btn = (label: string, d: number) => (
    <button type="button" disabled={disabled} onClick={() => onAdj(d)}
      style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', fontSize: 16, fontWeight: 800, lineHeight: 1, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {label}
    </button>
  )
  return <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{btn('−', -1)}{btn('+', 1)}</div>
}
function adjBtnStyle(color: string): React.CSSProperties {
  return { flex: 1, padding: '12px 0', borderRadius: 12, border: `1px solid ${color}40`, background: `${color}14`, color, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }
}
// Канон подписей: enum card = «Перевод» (на карту), enum transfer = «СБП» (Platega QR) — как кнопки в POS.
const PAY_LABELS: Record<string, string> = {
  cash: 'Наличные', card: 'Перевод', transfer: 'СБП', bonus: 'Бонусы',
  deposit: 'Депозит', debt: 'Долг', certificate: 'Сертификат', split: 'Раздельная',
}

// DELETE с телом запроса. Хелпер из lib/api.ts (api.delete) тело не передаёт,
// а контракт DELETE /clients/:id/tg-link ожидает JSON { tgId }. Повторяем
// заголовки/BASE_URL из lib/api.ts, чтобы отвязать конкретный аккаунт.
async function deleteWithBody<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? '/api'
  const token = useAuthStore.getState().token
  const res = await fetch(`${base}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    const err = (data as any)?.error
    const message: string =
      typeof err === 'string' ? err
      : (err?.issues?.[0]?.message ?? err?.message ?? (data as any)?.message ?? res.statusText)
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Тип одного привязанного Telegram-аккаунта профиля клиента.
type TgAccount = { tgId: string; username: string | null; primary: boolean }

export default function ClientsPage() {
  const qc = useQueryClient()
  const { show } = useToast()
  const router = useRouter()
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState(false)
  // Разделы: Все / Резиденты / Студенты / Новички / Гости / Архив (заблокированные).
  const [seg, setSeg] = useState<'all' | 'newbie' | 'resident' | 'guest' | 'student' | 'archive'>('all')
  // Сортировка списка. По умолчанию — по последним пробитым чекам.
  type SortKey = 'last_check' | 'recent' | 'name' | 'balance' | 'bonus'
  const [sort, setSort] = useState<SortKey>('last_check')
  const [search, setSearch] = useState('')
  const [dbSearch, setDbSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  // Личное уведомление клиенту (приложение My Titan).
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [tab, setTab] = useState<'info' | 'tx'>('info')
  const [form, setForm] = useState({ nickname: '', fullName: '', phone: '', birthday: '', clientTier: 'newbie', password: '', photoUrl: '', gomafiaId: '' })
  // Подбор игрока с GoMafia (для нового клиента).
  const [gmQuery, setGmQuery] = useState('')
  const [gmResults, setGmResults] = useState<any[]>([])
  const [gmLoading, setGmLoading] = useState(false)
  const [gmOpen, setGmOpen] = useState(false)
  // Сопоставление существующего клиента с GoMafia (модалка из карточки клиента).
  const [gmMatchOpen, setGmMatchOpen] = useState(false)
  const [gmMatchQuery, setGmMatchQuery] = useState('')
  const [gmMatchResults, setGmMatchResults] = useState<any[]>([])
  const [gmMatchLoading, setGmMatchLoading] = useState(false)
  // Загрузка фото клиента сотрудником (главный приоритет).
  const [photoUploading, setPhotoUploading] = useState(false)
  const [editForm, setEditForm] = useState<any>(null)
  const [tagsInput, setTagsInput] = useState('')
  const [tgQr, setTgQr] = useState<{ deepLink: string; qrDataUrl: string } | null>(null)
  // Модалка «Участники чата» — сопоставление клиента с TG из ростера бота.
  const [tgRosterOpen, setTgRosterOpen] = useState(false)
  const [tgRosterSearch, setTgRosterSearch] = useState('')
  // Аккаунт, который собираемся отвязать (для ConfirmDialog).
  const [tgUnlinkTarget, setTgUnlinkTarget] = useState<TgAccount | null>(null)
  // Модалка начисления/списания (баланс или бонусы).
  const [adjModal, setAdjModal] = useState<{ kind: 'balance' | 'bonus'; op: 'add' | 'sub' } | null>(null)
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [checkModalId, setCheckModalId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDbSearch(search), 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [search])

  // Бесконечная подгрузка по скроллу (useInfiniteQuery). Доп. параметры запроса:
  // раздел (архив/статус) и сортировка.
  const segParam = seg === 'archive' ? '&filter=archived' : seg !== 'all' ? `&tier=${seg}` : ''
  const sortParam = `&sort=${sort}`
  const {
    data: infData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['clients', dbSearch, seg, sort],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<any>(`/clients?search=${encodeURIComponent(dbSearch)}&page=${pageParam}${segParam}${sortParam}`),
    getNextPageParam: (lastPage: any, allPages: any[]) => {
      const loaded = allPages.reduce((n, p) => n + (p?.clients?.length ?? 0), 0)
      return loaded < (lastPage?.total ?? 0) ? allPages.length + 1 : undefined
    },
    staleTime: 10000,
  })
  // Склейка страниц в один список (дедуп по id — на случай сдвигов пагинации).
  const data = useMemo(() => {
    const seen = new Set<string>()
    const merged: any[] = []
    for (const pg of (infData?.pages ?? [])) {
      for (const cl of (pg?.clients ?? [])) if (!seen.has(cl.id)) { seen.add(cl.id); merged.push(cl) }
    }
    return { clients: merged, total: infData?.pages?.[0]?.total ?? merged.length }
  }, [infData])

  // Автоподгрузка: следим за «маяком» в конце списка.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const { data: txData } = useQuery({ queryKey: ['clients', selected?.id, 'tx'], queryFn: () => api.get<any>(`/clients/${selected.id}/transactions`), enabled: !!selected?.id && tab === 'tx' })
  const { data: vpData } = useQuery({ queryKey: ['clients', selected?.id, 'visit'], queryFn: () => api.get<{ tier: string; visits: number; threshold: number; remaining: number; isResident: boolean }>(`/clients/${selected.id}/visit-progress`), enabled: !!selected?.id && tab === 'tx' })
  const { data: checkDetail } = useQuery({ queryKey: ['check-detail', checkModalId], queryFn: () => api.get<any>(`/analytics/checks/${checkModalId}`), enabled: !!checkModalId })

  // Справочник статусов (динамический). Фоллбек на встроенные метки/цвета, если
  // справочник ещё не загрузился, чтобы UI не «прыгал».
  const { data: tiersData } = useQuery({ queryKey: ['client-tiers'], queryFn: () => api.get<{ tiers: TierRow[] }>('/clients/tiers') })
  const tierList: TierRow[] = tiersData?.tiers ?? Object.keys(TIER_LABELS).map((k, i) => ({ key: k, label: TIER_LABELS[k], color: TIER_COLORS[k] ?? '#8B5CF6', sortOrder: i, isSystem: ['newbie', 'guest', 'resident', 'student'].includes(k) }))
  const labelOf = (k: string) => tierList.find(t => t.key === k)?.label ?? TIER_LABELS[k] ?? k
  const colorOf = (k: string) => tierList.find(t => t.key === k)?.color ?? TIER_COLORS[k] ?? '#8B5CF6'

  const resetCreateForm = () => { setForm({ nickname: '', fullName: '', phone: '', birthday: '', clientTier: 'newbie', password: '', photoUrl: '', gomafiaId: '' }); setGmQuery(''); setGmResults([]); setGmOpen(false) }
  const create = useMutation({ mutationFn: (b: any) => api.post('/clients', b), onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); setShowCreate(false); resetCreateForm() }, onError: () => show('Не удалось создать клиента', 'error') })

  // Подбор GoMafia: дебаунс-поиск по нику (состав клуба + все игроки сайта).
  useEffect(() => {
    const q = gmQuery.trim()
    if (q.length < 2) { setGmResults([]); setGmLoading(false); return }
    setGmLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ players: any[] }>(`/gomafia/search?q=${encodeURIComponent(q)}`)
        setGmResults(Array.isArray(r.players) ? r.players : [])
      } catch { setGmResults([]) }
      finally { setGmLoading(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [gmQuery])

  // Выбор игрока: тянем полную карточку (имя/фамилия) и заполняем форму.
  async function pickGomafia(p: any) {
    setGmOpen(false)
    setGmQuery('')
    setGmResults([])
    setForm(prev => ({
      ...prev,
      nickname: p.login || prev.nickname,
      photoUrl: p.avatar || '',
      gomafiaId: String(p.gomafiaId),
    }))
    try {
      const r = await api.get<{ player: any }>(`/gomafia/player/${p.gomafiaId}`)
      const full = r.player?.fullName
      if (full) setForm(prev => ({ ...prev, fullName: full }))
    } catch { /* имя необязательно */ }
  }

  // Сопоставление существующего клиента с GoMafia: дебаунс-поиск (клуб → все).
  useEffect(() => {
    if (!gmMatchOpen) return
    const q = gmMatchQuery.trim()
    if (q.length < 2) { setGmMatchResults([]); setGmMatchLoading(false); return }
    setGmMatchLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ players: any[] }>(`/gomafia/search?q=${encodeURIComponent(q)}`)
        setGmMatchResults(Array.isArray(r.players) ? r.players : [])
      } catch { setGmMatchResults([]) }
      finally { setGmMatchLoading(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [gmMatchQuery, gmMatchOpen])

  const gomafiaLinkMut = useMutation({
    mutationFn: (gomafiaId: string) => api.post<{ client: any; gomafia: any }>(`/clients/${selected.id}/gomafia-link`, { gomafiaId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      if (res?.client) setSelected(res.client)
      setGmMatchOpen(false); setGmMatchQuery(''); setGmMatchResults([])
      show('Клиент сопоставлен с GoMafia', 'success')
    },
    onError: (e: any) => show(e?.message || 'Не удалось сопоставить', 'error'),
  })
  const gomafiaUnlinkMut = useMutation({
    mutationFn: () => api.delete<{ client: any }>(`/clients/${selected.id}/gomafia-link`),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      if (res?.client) setSelected(res.client)
      show('Привязка GoMafia снята', 'success')
    },
    onError: () => show('Не удалось отвязать', 'error'),
  })

  // Загрузить ручное фото (главный приоритет): upload в хранилище → photoUrl клиента.
  async function uploadClientPhoto(file: File) {
    if (!selected) return
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const base = process.env.NEXT_PUBLIC_API_URL ?? '/api'
      const token = useAuthStore.getState().token
      const res = await fetch(`${base}/upload/image`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd })
      if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(e?.error || 'upload failed') }
      const { url } = await res.json()
      await api.patch(`/clients/${selected.id}`, { photoUrl: url })
      setSelected((prev: any) => (prev ? { ...prev, photoUrl: url } : prev))
      qc.invalidateQueries({ queryKey: ['clients'] })
      show('Фото загружено', 'success')
    } catch (e: any) {
      show(e?.message === 'Файл больше 8 МБ' ? 'Файл больше 8 МБ' : 'Не удалось загрузить фото', 'error')
    } finally { setPhotoUploading(false) }
  }
  async function removeClientPhoto() {
    if (!selected) return
    try {
      await api.patch(`/clients/${selected.id}`, { photoUrl: null })
      setSelected((prev: any) => (prev ? { ...prev, photoUrl: null } : prev))
      qc.invalidateQueries({ queryKey: ['clients'] })
      show('Ручное фото удалено', 'success')
    } catch { show('Не удалось удалить фото', 'error') }
  }

  const update = useMutation({
    mutationFn: ({ id, ...b }: any) => api.patch(`/clients/${id}`, b),
    onSuccess: (res: any, vars: any) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      // Архивирование/восстановление (deletedAt задан или сброшен в null) — закрываем
      // карточку; обычное сохранение — назад в просмотр.
      if (vars?.deletedAt !== undefined) { setSelected(null); setConfirmBlock(false); return }
      const merged = { ...selected, ...vars }
      delete (merged as any).deletedAt
      setSelected(merged)
      setMode('view')
    },
    // 409 — архивация клиента с ненулевым балансом: показываем текст сервера (что закрыть).
    onError: (e: any) => { setConfirmBlock(false); show(e?.status === 409 && e?.message ? e.message : 'Не удалось сохранить изменения', 'error') },
  })
  // Полное удаление из архива (НАВСЕГДА).
  const purge = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}/permanent`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); setConfirmPurge(false); setSelected(null); show('Клиент удалён навсегда', 'success') },
    onError: () => { setConfirmPurge(false); show('Не удалось удалить клиента', 'error') },
  })
  const adjBal = useMutation({ mutationFn: ({ id, amount, reason }: any) => api.post(`/clients/${id}/balance`, { amount, reason: reason ?? 'Корректировка баланса' }), onSuccess: (_r, vars: any) => { qc.invalidateQueries({ queryKey: ['clients'] }); setSelected((s: any) => s ? { ...s, balance: parseNum(s.balance) + parseNum(vars.amount) } : s) }, onError: () => show('Не удалось изменить баланс', 'error') })
  const adjBon = useMutation({ mutationFn: ({ id, amount, reason }: any) => api.post(`/clients/${id}/bonus`, { amount, reason: reason ?? 'Корректировка бонусов' }), onSuccess: (_r, vars: any) => { qc.invalidateQueries({ queryKey: ['clients'] }); setSelected((s: any) => s ? { ...s, bonusPoints: parseNum(s.bonusPoints) + parseNum(vars.amount) } : s) }, onError: () => show('Не удалось изменить бонусы', 'error') })
  // Виртуальные посещения (±) — без влияния на кассу; могут повысить до Резидента.
  const adjVisits = useMutation({
    mutationFn: ({ id, delta }: { id: string; delta: number }) => api.post<any>(`/clients/${id}/visits`, { delta }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['clients', selected?.id, 'visit'] })
      qc.invalidateQueries({ queryKey: ['clients', selected?.id, 'tx'] })
      if (res?.promoted) { qc.invalidateQueries({ queryKey: ['clients'] }); show('Клиент повышен до «Резидент» 🎉', 'success') }
    },
    onError: () => show('Не удалось изменить посещения', 'error'),
  })

  function openAdj(kind: 'balance' | 'bonus', op: 'add' | 'sub') { setAdjModal({ kind, op }); setAdjAmount(''); setAdjComment('') }
  function confirmAdj() {
    if (!selected || !adjModal) return
    const amt = Math.abs(Number(adjAmount))
    if (!(amt > 0) || adjComment.trim().length < 3) return
    const signed = adjModal.op === 'add' ? amt : -amt
    const args = { id: selected.id, amount: signed, reason: adjComment.trim() }
    if (adjModal.kind === 'balance') adjBal.mutate(args)
    else adjBon.mutate(args)
    setAdjModal(null); setAdjAmount(''); setAdjComment('')
  }
  const telegramLinkMut = useMutation({ mutationFn: (id: string) => api.post<any>(`/clients/${id}/telegram-link`, {}), onSuccess: (res: any) => { setTgQr({ deepLink: res.deepLink, qrDataUrl: res.qrDataUrl }) }, onError: () => show('Не удалось создать ссылку привязки', 'error') })

  // ── Telegram-аккаунты профиля ────────────────────────────────────────────────
  // Список привязанных аккаунтов клиента (один человек может иметь несколько TG).
  // Грузим только при открытой карточке с известным id.
  const tgAccountsQ = useQuery({
    queryKey: ['clients', selected?.id, 'tg-accounts'],
    queryFn: () => api.get<{ accounts: TgAccount[] }>(`/clients/${selected.id}/tg-accounts`),
    enabled: !!selected?.id,
  })
  const tgAccounts: TgAccount[] = tgAccountsQ.data?.accounts ?? []

  // ── Сопоставление с TG из чата ──────────────────────────────────────────────
  // Ростер участников: грузим только когда открыта модалка «Участники чата».
  type TgRosterUser = { tgId: string; username: string | null; firstName: string | null; lastName: string | null; chatId: string | null; lastSeen: string; linkedTo: string | null }
  const tgRoster = useQuery({
    queryKey: ['clients', 'tg-roster'],
    queryFn: () => api.get<{ users: TgRosterUser[] }>('/clients/tg-roster'),
    enabled: tgRosterOpen,
  })
  // Привязка по выбору из ростера. ДОБАВЛЯЕТ аккаунт к профилю (не перезаписывает) —
  // поддержка нескольких Telegram на одного человека.
  const tgMatchMut = useMutation({
    mutationFn: ({ id, tgId, tgUsername }: { id: string; tgId: string; tgUsername: string | null }) =>
      api.post<any>(`/clients/${id}/tg-link`, { tgId, tgUsername: tgUsername ?? undefined }),
    onSuccess: (_res: any, vars) => {
      qc.invalidateQueries({ queryKey: ['clients', vars.id, 'tg-accounts'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      show('Аккаунт привязан', 'success')
      setTgRosterOpen(false)
      setTgRosterSearch('')
    },
    onError: (e: any) => show(e?.message ?? 'Не удалось привязать', 'error'),
  })
  // Отвязка конкретного аккаунта — DELETE с телом { tgId }.
  const tgUnlinkMut = useMutation({
    mutationFn: ({ id, tgId }: { id: string; tgId: string }) =>
      deleteWithBody<{ ok: boolean }>(`/clients/${id}/tg-link`, { tgId }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['clients', vars.id, 'tg-accounts'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      show('Отвязано', 'success')
      setTgUnlinkTarget(null)
    },
    onError: (e: any) => show(e?.message ?? 'Не удалось отвязать', 'error'),
  })

  const clients: any[] = data?.clients ?? []
  const total: number = data?.total ?? clients.length

  function openDetail(c: any) {
    setSelected(c)
    setMode('view')
    setTab('info')
    setTgQr(null)
    setTgRosterOpen(false); setTgRosterSearch(''); setTgUnlinkTarget(null)
    setGmMatchOpen(false); setGmMatchQuery(''); setGmMatchResults([])
    setAdjModal(null); setAdjAmount(''); setAdjComment('')
  }

  // Перевод в режим редактирования: заполняем форму из выбранного клиента.
  function startEdit() {
    if (!selected) return
    const tags: string[] = Array.isArray(selected.searchTags) ? selected.searchTags : []
    setEditForm({
      nickname: selected.nickname ?? '',
      fullName: selected.fullName ?? '',
      phone: selected.phone ?? '',
      birthday: selected.birthday ? String(selected.birthday).slice(0, 10) : '',
      clientTier: selected.clientTier ?? 'guest',
    })
    // Тег gomafia:* управляется отдельным блоком — в поле «Теги» его не показываем.
    setTagsInput(tags.filter(t => !MANAGED_TAG_RE.test(t)).join(', '))
    setTgQr(null)
    setMode('edit')
  }

  function saveEdit() {
    if (!selected) return
    // Сохраняем привязку GoMafia (тег gomafia:*) — поле «Теги» её не затирает.
    const manual = tagsInput.split(',').map(t => t.trim()).filter(Boolean).filter(t => !MANAGED_TAG_RE.test(t))
    const gm = (Array.isArray(selected.searchTags) ? selected.searchTags : []).filter((t: string) => MANAGED_TAG_RE.test(t))
    const searchTags = [...manual, ...gm]
    update.mutate({
      id: selected.id,
      nickname: editForm.nickname,
      fullName: editForm.fullName,
      phone: editForm.phone || null,
      birthday: editForm.birthday || null,
      clientTier: editForm.clientTier,
      searchTags,
    })
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Клиенты"
        subtitle={`${total} ${total % 10 === 1 && total % 100 !== 11 ? 'игрок' : 'игроков'}`}
        action={{ label: 'Добавить', icon: 'person_add', onClick: () => setShowCreate(true) }}
      />

      {/* Search + tier chips */}
      <div style={{ background: 'rgba(21,18,27,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
        <div>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Icon name="search" size={18} color="var(--on-surface-variant)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по нику или телефону…" style={{ ...INP, paddingLeft: 42, borderRadius: 12 }} />
          </div>
          {/* Разделы (по иерархии): Все · Резиденты · Студенты · Новички · Гости · Архив */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, marginBottom: 8 }}>
            {([['all', 'Все', 'group'], ['resident', 'Резиденты', 'workspace_premium'], ['student', 'Студенты', 'school'], ['newbie', 'Новички', 'fiber_new'], ['guest', 'Гости', 'person'], ['archive', 'Архив', 'archive']] as [typeof seg, string, string][]).map(([key, label, icon]) => {
              const isArch = key === 'archive'
              return (
                <Chip key={key} active={seg === key} onClick={() => setSeg(key)} icon={icon} activeColor={isArch ? '#64748B' : undefined}>
                  {label}
                </Chip>
              )
            })}
          </div>
          {/* Сортировка */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, alignItems: 'center' }}>
            {([['last_check', 'Активные'], ['recent', 'Новые'], ['name', 'А–Я'], ['balance', 'Баланс'], ['bonus', 'Бонусы']] as [SortKey, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setSort(key)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, border: '1px solid ' + (sort === key ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.1)'), background: sort === key ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)', color: sort === key ? '#a78bfa' : 'var(--on-surface-variant)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
            <button onClick={() => router.push('/manage/pricing?tab=tariffs')} style={{ flexShrink: 0, marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 999, border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.1)', color: '#a78bfa', whiteSpace: 'nowrap', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="sell" size={13} /> Статусы
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px var(--bottom-nav-clear)', flex: 1, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {clients.length === 0 ? (
          isLoading && !data
            ? <StateView state="loading" />
            : <StateView state="empty" icon="group" title="Клиенты не найдены" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clients.map((c: any) => {
              const tier = c.clientTier ?? 'guest'
              const tierColor = colorOf(tier)
              return (
                <div key={c.id} className="glass-l2" onClick={() => openDetail(c)}
                  style={{ position: 'relative', overflow: 'hidden', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', transition: 'border-color 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = `${tierColor}55` }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}>
                  {avatarOf(c)
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarOf(c)!} alt={c.nickname} width={46} height={46} style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: `2px solid ${tierColor}55` }} />
                    : <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, background: `${tierColor}22`, border: `2px solid ${tierColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: tierColor }}>
                        {(c.nickname ?? '?').slice(0, 2).toUpperCase()}
                      </div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const, marginBottom: 4 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{c.nickname}</p>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", padding: '2px 7px', borderRadius: 6, background: `${tierColor}22`, color: tierColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{labelOf(tier)}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>{c.phone ?? 'Нет телефона'}</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', margin: 0, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(parseNum(c.balance))} ₽</p>
                    <p style={{ fontSize: 11, color: '#EAB308', margin: '3px 0 0', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                      <Icon name="star" size={12} />{fmt(parseNum(c.bonusPoints))}
                    </p>
                  </div>
                </div>
              )
            })}
            {/* Маяк бесконечной подгрузки + индикатор */}
            <div ref={sentinelRef} style={{ height: 1 }} />
            {isFetchingNextPage && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0', color: 'var(--on-surface-variant)' }}>
                <Icon name="progress_activity" size={22} style={{ animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!hasNextPage && clients.length > 0 && (
              <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--on-surface-variant)', padding: '12px 0 0', margin: 0 }}>
                Все клиенты загружены · {total}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Create sheet */}
      <Sheet open={showCreate} onClose={() => setShowCreate(false)} title="Новый клиент">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Подбор игрока с GoMafia */}
          <div style={{ border: '1px solid rgba(139,92,246,0.25)', background: 'rgba(139,92,246,0.06)', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Icon name="search" size={16} color="#a78bfa" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>Подбор с GoMafia</span>
            </div>

            {form.gomafiaId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {form.photoUrl
                  ? <img src={form.photoUrl} alt="" width={40} height={40} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="person" size={20} color="#a78bfa" /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.nickname}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>GoMafia #{form.gomafiaId}{form.fullName ? ` · ${form.fullName}` : ''}</p>
                </div>
                <IconButton icon="close" variant="ghost" ariaLabel="Отвязать от GoMafia" onClick={() => setForm(p => ({ ...p, photoUrl: '', gomafiaId: '' }))} />
              </div>
            ) : (
              <>
                <input value={gmQuery} onChange={e => { setGmQuery(e.target.value); setGmOpen(true) }} placeholder="Ник игрока на GoMafia…" style={{ ...INP, borderRadius: 10 }} />
                {gmOpen && gmQuery.trim().length >= 2 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
                    {gmLoading && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '4px 2px' }}>Поиск…</p>}
                    {!gmLoading && gmResults.length === 0 && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '4px 2px' }}>Игроки не найдены</p>}
                    {gmResults.map(p => (
                      <button key={p.gomafiaId} type="button" onClick={() => pickGomafia(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                        {p.avatar
                          ? <img src={p.avatar} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                          : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="person" size={18} color="var(--on-surface-variant)" /></div>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.login}</span>
                            {p.inClub && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: 'rgba(139,92,246,0.2)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>клуб</span>}
                          </div>
                          <p style={{ margin: '1px 0 0', fontSize: 11, color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.clubTitle ? p.clubTitle : 'Без клуба'}{p.elo != null ? ` · ELO ${Math.round(p.elo)}` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '8px 2px 0', lineHeight: 1.4 }}>
                  Найдите игрока — ник, имя и фото подставятся автоматически. Сначала показываются игроки вашего клуба.
                </p>
              </>
            )}
          </div>

          {([['Никнейм *', 'nickname', 'text'], ['Имя', 'fullName', 'text'], ['Телефон', 'phone', 'tel'], ['День рождения', 'birthday', 'date'], ['Пароль', 'password', 'password']] as [string, string, string][]).map(([lbl, key, type]) => (
            <div key={key}><label style={LBL}>{lbl}</label><input type={type} value={(form as any)[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} style={INP} placeholder={key === 'fullName' ? 'Реальное имя' : undefined} /></div>
          ))}
          <div><label style={LBL}>Статус</label><select value={form.clientTier} onChange={e => setForm(p => ({ ...p, clientTier: e.target.value }))} style={{ ...INP, background: 'rgba(29,26,36,0.8)', cursor: 'pointer' } as React.CSSProperties}>{tierList.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
          <button onClick={() => create.mutate({
            nickname: form.nickname,
            fullName: form.fullName || null,
            phone: form.phone || undefined,
            birthday: form.birthday || undefined,
            clientTier: form.clientTier,
            password: form.password || undefined,
            gomafiaPhotoUrl: form.photoUrl || undefined,
            searchTags: form.gomafiaId ? [`gomafia:${form.gomafiaId}`] : [],
          })} disabled={create.isPending || !form.nickname.trim()} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: create.isPending || !form.nickname.trim() ? 0.6 : 1, marginTop: 4 }}>
            {create.isPending ? 'Создаём…' : 'Создать клиента'}
          </button>
        </div>
      </Sheet>

      {/* Detail sheet */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} maxHeight="92vh">
        {selected && (() => {
          const tier = selected.clientTier ?? 'guest'
          const tierColor = colorOf(tier)
          const bal = parseNum(selected.balance)
          const debt = bal < 0 ? -bal : 0
          const deposit = bal > 0 ? bal : 0

          // ── РЕЖИМ РЕДАКТИРОВАНИЯ ──────────────────────────────────────────
          if (mode === 'edit' && editForm) {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <IconButton icon="arrow_back" ariaLabel="Назад" variant="ghost" onClick={() => setMode('view')} />
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Редактирование</h2>
                </div>

                {/* Аватар по центру — клик заменяет фото */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <label style={{ position: 'relative', width: 96, height: 96, flexShrink: 0, cursor: photoUploading ? 'default' : 'pointer' }}>
                    {avatarOf(selected)
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarOf(selected)!} alt="" width={96} height={96} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${colorOf(editForm.clientTier)}66` }} />
                      : <div style={{ width: 96, height: 96, borderRadius: '50%', background: `${colorOf(editForm.clientTier)}22`, border: `2px solid ${colorOf(editForm.clientTier)}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: colorOf(editForm.clientTier) }}>{(editForm.nickname || selected.nickname || '?').slice(0, 2).toUpperCase()}</div>}
                    <span style={{ position: 'absolute', right: 2, bottom: 2, width: 30, height: 30, borderRadius: '50%', background: '#8B5CF6', border: '2px solid #1d1828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="edit" size={15} color="#fff" />
                    </span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={photoUploading}
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadClientPhoto(f); e.target.value = '' }} />
                  </label>
                  <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>{photoUploading ? 'Загрузка…' : 'Нажмите, чтобы заменить фото'}</p>
                  {selected.photoUrl && (
                    <button type="button" onClick={removeClientPhoto} style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Удалить загруженное
                    </button>
                  )}
                </div>

                {/* Никнейм + Имя */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={LBL}>Никнейм</label><input value={editForm.nickname} onChange={e => setEditForm((p: any) => ({ ...p, nickname: e.target.value }))} style={INP} /></div>
                  <div><label style={LBL}>Имя</label><input value={editForm.fullName} onChange={e => setEditForm((p: any) => ({ ...p, fullName: e.target.value }))} style={INP} placeholder="Реальное имя" /></div>
                </div>
                {/* Теги */}
                <div><label style={LBL}>Теги (через запятую)</label><input value={tagsInput} onChange={e => setTagsInput(e.target.value)} style={INP} placeholder="VIP, друг, постоянный" /></div>
                {/* Телефон + День рождения */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={LBL}>Телефон</label><input type="tel" value={editForm.phone} onChange={e => setEditForm((p: any) => ({ ...p, phone: e.target.value }))} style={INP} /></div>
                  <div><label style={LBL}>День рождения</label><input type="date" value={editForm.birthday} onChange={e => setEditForm((p: any) => ({ ...p, birthday: e.target.value }))} style={INP} /></div>
                </div>
                {/* Статус — кнопки */}
                <div>
                  <label style={LBL}>Статус</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {tierList.map(t => (
                      <Chip key={t.key} active={editForm.clientTier === t.key} activeColor={t.color}
                        onClick={() => setEditForm((p: any) => ({ ...p, clientTier: t.key }))}>
                        {t.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {/* ─── Интеграции ─────────────────────────────────────────── */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: 'var(--on-surface)' }}>Интеграции</h3>

                  {/* GoMafia */}
                  <div>
                    <p style={{ ...LBL, marginBottom: 10 }}>GoMafia</p>
                    {(() => {
                      const gid = gomafiaIdOf(selected)
                      return gid ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <Icon name="sports_esports" size={20} color="#a78bfa" style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)' }}>Профиль #{gid}</span>
                            <a href={`https://gomafia.pro/stats/${gid}`} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 12, color: '#a78bfa', textDecoration: 'none' }}>Открыть на GoMafia ↗</a>
                          </div>
                          <IconButton icon="link_off" variant="danger" ariaLabel="Отвязать GoMafia" disabled={gomafiaUnlinkMut.isPending} onClick={() => gomafiaUnlinkMut.mutate()} />
                        </div>
                      ) : (
                        <Button variant="secondary" fullWidth icon="search" onClick={() => { setGmMatchOpen(true); setGmMatchQuery(''); setGmMatchResults([]) }}>
                          Сопоставить с GoMafia
                        </Button>
                      )
                    })()}
                  </div>

                  {/* Telegram */}
                  <div>
                    <p style={{ ...LBL, marginBottom: 10 }}>Telegram</p>
                    {tgAccountsQ.isLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0', color: 'var(--on-surface-variant)' }}>
                        <Icon name="progress_activity" size={22} style={{ animation: 'spin 1s linear infinite' }} />
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      </div>
                    ) : tgAccounts.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>Нет привязанных аккаунтов</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {tgAccounts.map((acc) => (
                          <div key={acc.tgId}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <Icon name="telegram" size={20} color="#229ED9" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {acc.username ? `@${acc.username}` : `id ${acc.tgId}`}
                              </span>
                              {acc.primary && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(34,158,217,0.16)', color: '#229ED9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>основной</span>
                              )}
                            </div>
                            <IconButton icon="link_off" ariaLabel="Отвязать" variant="danger"
                              disabled={tgUnlinkMut.isPending}
                              onClick={() => setTgUnlinkTarget(acc)} />
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {/* «Сопоставить из чата» — доступно для ВСЕХ статусов
                          (резидент/студент/новичок/гость и любые кастомные). */}
                      <Button variant="secondary" fullWidth icon="forum" onClick={() => setTgRosterOpen(true)}>
                        Сопоставить из чата
                      </Button>
                      {tgQr ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.04)' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={tgQr.qrDataUrl} alt="QR для привязки Telegram" width={180} height={180} style={{ borderRadius: 12, background: '#fff', padding: 6 }} />
                          <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', textAlign: 'center', margin: 0 }}>Отсканируйте QR в Telegram, чтобы привязать аккаунт</p>
                          <a href={tgQr.deepLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: '#229ED9', textDecoration: 'none' }}>Открыть в Telegram</a>
                        </div>
                      ) : (
                        <Button variant="ghost" fullWidth icon="link"
                          loading={telegramLinkMut.isPending}
                          onClick={() => telegramLinkMut.mutate(selected.id)}>
                          Получить ссылку для саморегистрации
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <Button fullWidth size="lg" loading={update.isPending} disabled={!editForm.nickname?.trim()} onClick={saveEdit}>Сохранить</Button>
                <Button variant="ghost" fullWidth onClick={() => setMode('view')}>Отмена</Button>
              </div>
            )
          }

          // ── РЕЖИМ ПРОСМОТРА ──────────────────────────────────────────────
          return (
            <div>
              {/* Шапка: фото / инициалы по центру */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 18 }}>
                {avatarOf(selected) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarOf(selected)!} alt={selected.nickname} width={88} height={88} style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${tierColor}55` }} />
                ) : (
                  <div style={{ width: 88, height: 88, borderRadius: '50%', background: `${tierColor}22`, border: `2px solid ${tierColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: tierColor }}>
                    {(selected.nickname ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: '8px 0 0', textAlign: 'center' }}>{selected.nickname}</h2>
                {selected.fullName ? <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: 0, textAlign: 'center' }}>{selected.fullName}</p> : null}
                <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", padding: '3px 8px', borderRadius: 6, background: `${tierColor}22`, color: tierColor, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{labelOf(tier)}</span>
              </div>

              {/* Пилюли статистики + Редактировать */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
                {([
                  ['star', 'Бонусы', fmt(parseNum(selected.bonusPoints)), '#EAB308'],
                  ['account_balance_wallet', 'Депозит', `${fmt(deposit)} ₽`, deposit > 0 ? '#10B981' : 'var(--on-surface-variant)'],
                  ['account_balance_wallet', 'Долг', `${debt > 0 ? '−' : ''}${fmt(debt)} ₽`, debt > 0 ? '#F43F5E' : 'var(--on-surface-variant)'],
                ] as [string, string, string, string][]).map(([icon, lbl, val, color]) => (
                  <div key={lbl} style={{ padding: '10px 6px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', textAlign: 'center' }}>
                    <Icon name={icon} size={16} color={color} style={{ display: 'block', margin: '0 auto 4px' }} />
                    <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 2px', fontFamily: "'JetBrains Mono',monospace", color }}>{val}</p>
                    <p style={{ fontSize: 9, color: 'var(--on-surface-variant)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono',monospace" }}>{lbl}</p>
                  </div>
                ))}
                <button onClick={startEdit} style={{ padding: '10px 6px', borderRadius: 12, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Icon name="edit" size={16} color="#a78bfa" />
                  <span style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Изменить</span>
                </button>
              </div>

              {/* Вкладки */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
                {[['info', 'Основное'], ['tx', 'Транзакции']].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k as any)} style={{ padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: tab === k ? 700 : 400, color: tab === k ? '#8B5CF6' : 'var(--on-surface-variant)', borderBottom: tab === k ? '2px solid #8B5CF6' : '2px solid transparent', marginBottom: -1 }}>{l}</button>
                ))}
              </div>

              {tab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Баланс — начислить / списать */}
                  <div>
                    <p style={{ ...LBL, marginBottom: 10 }}>Баланс (₽)</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openAdj('balance', 'add')} style={adjBtnStyle('#10B981')}><Icon name="add" size={16} />Начислить</button>
                      <button onClick={() => openAdj('balance', 'sub')} style={adjBtnStyle('#F43F5E')}><Icon name="remove" size={16} />Списать</button>
                    </div>
                  </div>
                  {/* Бонусы — начислить / списать */}
                  <div>
                    <p style={{ ...LBL, marginBottom: 10 }}>Бонусы (⭐)</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => openAdj('bonus', 'add')} style={adjBtnStyle('#EAB308')}><Icon name="add" size={16} />Начислить</button>
                      <button onClick={() => openAdj('bonus', 'sub')} style={adjBtnStyle('#94A3B8')}><Icon name="remove" size={16} />Списать</button>
                    </div>
                  </div>

                  {/* Контакты */}
                  <div style={{ display: 'flex', gap: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
                    <button onClick={() => selected.phone && openContact(telLink(selected.phone))} disabled={!selected.phone}
                      style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#10B981', fontSize: 13, fontWeight: 700, cursor: selected.phone ? 'pointer' : 'not-allowed', opacity: selected.phone ? 1 : 0.45, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="call" size={16} />Позвонить
                    </button>
                    <button onClick={() => selected.tgUsername && openContact(`https://t.me/${selected.tgUsername}`)} disabled={!selected.tgUsername}
                      style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(34,158,217,0.3)', background: 'rgba(34,158,217,0.1)', color: '#229ED9', fontSize: 13, fontWeight: 700, cursor: selected.tgUsername ? 'pointer' : 'not-allowed', opacity: selected.tgUsername ? 1 : 0.45, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="telegram" size={16} />Написать
                    </button>
                    <button onClick={() => setNotifyOpen(true)}
                      style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(139,92,246,0.1)', color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="notifications" size={16} />В приложение
                    </button>
                  </div>

                  {/* Архив / восстановление / полное удаление */}
                  {selected.deletedAt ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      <button onClick={() => update.mutate({ id: selected.id, deletedAt: null })} disabled={update.isPending} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#10B981', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: update.isPending ? 0.6 : 1 }}>
                        <Icon name="restore" size={16} />Восстановить из архива
                      </button>
                      <button onClick={() => setConfirmPurge(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Icon name="delete_forever" size={16} />Удалить навсегда
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmBlock(true)} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: '1px solid rgba(244,63,94,0.3)', background: 'rgba(244,63,94,0.08)', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="archive" size={16} />В архив
                    </button>
                  )}
                </div>
              )}

              {tab === 'tx' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Счётчик посещений и ручное начисление — ТОЛЬКО для новичков
                      (после 10 посещений → Резидент). У прочих статусов не показываем. */}
                  {vpData && vpData.tier === 'newbie' && selected && (
                    <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Новичок → Резидент</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa', fontFamily: "'JetBrains Mono',monospace" }}>{vpData.visits}/{vpData.threshold}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (vpData.visits / vpData.threshold) * 100)}%`, background: 'linear-gradient(90deg,#8B5CF6,#4cd7f6)', borderRadius: 4, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '8px 0 0' }}>
                        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, flex: 1 }}>
                          {vpData.remaining > 0 ? `Осталось ${vpData.remaining} ${pluralVisits(vpData.remaining)} до статуса «Резидент»` : 'Порог достигнут — статус повысится сейчас'}
                        </p>
                        <VisitButtons disabled={adjVisits.isPending} onAdj={(d) => adjVisits.mutate({ id: selected.id, delta: d })} />
                      </div>
                    </div>
                  )}
                  {(() => {
                    // Скрываем дубли «Долг/Оплата депозитом за чек» (withdrawal с checkId) —
                    // их представляет строка «Оплата чека». Строки с чеком — кликабельные.
                    const rows = (txData?.transactions ?? []).filter((t: any) => !(t.checkId && t.type === 'withdrawal'))
                    if (!rows.length) return <p style={{ fontSize: 13, color: 'rgba(204,195,216,0.4)', textAlign: 'center', padding: '24px 0' }}>Нет транзакций</p>
                    return rows.map((tx: any) => {
                      const clickable = !!tx.checkId
                      const amt = parseNum(tx.amount)
                      const isVisit = tx.type === 'visit_adjust'
                      return (
                        <div key={tx.id} onClick={() => clickable && setCheckModalId(tx.checkId)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', cursor: clickable ? 'pointer' : 'default' }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                              {isVisit && <Icon name="event" size={13} color="#4cd7f6" />}{tx.description ?? tx.type}{clickable && <Icon name="receipt_long" size={13} color="#a78bfa" />}
                            </p>
                            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{tx.createdAt ? formatDistanceToNow(new Date(tx.createdAt), { locale: ru, addSuffix: true }) : ''}</p>
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 700, color: amt >= 0 ? '#10B981' : '#F43F5E', margin: 0, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                            {amt >= 0 ? '+' : ''}{isVisit ? `${amt} ${pluralVisits(Math.abs(amt))}` : `${fmt(amt)} ₽`}
                          </p>
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          )
        })()}
      </Sheet>

      {/* Уведомление клиенту — поверх карточки (порталы рисуются в порядке монтирования). */}
      <ClientNotifySheet client={selected} open={notifyOpen} onClose={() => setNotifyOpen(false)} />

      {/* Участники чата — сопоставление с TG из ростера бота */}
      <Sheet open={tgRosterOpen} onClose={() => { setTgRosterOpen(false); setTgRosterSearch('') }} title="Участники чата">
        {(() => {
          const users: any[] = tgRoster.data?.users ?? []
          const q = tgRosterSearch.trim().toLowerCase()
          const filtered = q
            ? users.filter((u: any) => [u.username, u.firstName, u.lastName, u.tgId].some((v: any) => String(v ?? '').toLowerCase().includes(q)))
            : users
          const nameOf = (u: any) => {
            const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
            return full || (u.username ? `@${u.username}` : u.tgId)
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Icon name="search" size={18} color="var(--on-surface-variant)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input value={tgRosterSearch} onChange={e => setTgRosterSearch(e.target.value)} placeholder="Поиск по имени, нику или ID…" style={{ ...INP, paddingLeft: 42, borderRadius: 12 }} />
              </div>

              {tgRoster.isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: 'var(--on-surface-variant)' }}>
                  <Icon name="progress_activity" size={26} style={{ animation: 'spin 1s linear infinite' }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              ) : users.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', lineHeight: 1.5, textAlign: 'center', padding: '16px 8px', margin: 0 }}>
                  Список пуст. Бот собирает участников, как только они проголосуют в опросе или напишут в чат. Включите сбор в разделе «Опросы» и убедитесь, что бот — админ группы.
                </p>
              ) : filtered.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center', padding: '16px 8px', margin: 0 }}>Никого не найдено</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {filtered.map((u: any) => {
                    // Уже привязан к другому клиенту — некликабельная строка с пометкой.
                    const takenByOther = !!u.linkedTo && u.linkedTo !== selected?.nickname
                    const seen = u.lastSeen ? formatDistanceToNow(new Date(u.lastSeen), { locale: ru, addSuffix: true }) : '—'
                    return (
                      <div key={u.tgId}
                        onClick={() => { if (!takenByOther && selected && !tgMatchMut.isPending) tgMatchMut.mutate({ id: selected.id, tgId: u.tgId, tgUsername: u.username }) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: takenByOther ? 'default' : 'pointer', opacity: takenByOther ? 0.55 : 1 }}>
                        <Icon name="telegram" size={20} color="#229ED9" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(u)}</p>
                          <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.username ? `@${u.username} · ` : ''}был(а) {seen}
                          </p>
                          {takenByOther && (
                            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>уже привязан к {u.linkedTo}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </Sheet>

      {/* Сопоставление клиента с игроком GoMafia (клуб → все игроки) */}
      <Sheet open={gmMatchOpen} onClose={() => { setGmMatchOpen(false); setGmMatchQuery('') }} title="Сопоставить с GoMafia">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={18} color="var(--on-surface-variant)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input value={gmMatchQuery} onChange={e => setGmMatchQuery(e.target.value)} autoFocus placeholder="Ник игрока на GoMafia…" style={{ ...INP, paddingLeft: 42, borderRadius: 12 }} />
          </div>

          {gmMatchQuery.trim().length < 2 ? (
            <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center', padding: '16px 8px', margin: 0, lineHeight: 1.5 }}>
              Введите ник игрока. Сначала показываются игроки вашего клуба, затем все игроки сайта.
            </p>
          ) : gmMatchLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0', color: 'var(--on-surface-variant)' }}>
              <Icon name="progress_activity" size={26} style={{ animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : gmMatchResults.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center', padding: '16px 8px', margin: 0 }}>Игроки не найдены</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {gmMatchResults.map((p: any) => (
                <div key={p.gomafiaId}
                  onClick={() => { if (selected && !gomafiaLinkMut.isPending) gomafiaLinkMut.mutate(String(p.gomafiaId)) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: gomafiaLinkMut.isPending ? 'default' : 'pointer', opacity: gomafiaLinkMut.isPending ? 0.6 : 1 }}>
                  {p.avatar
                    ? <img src={p.avatar} alt="" width={36} height={36} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="person" size={18} color="var(--on-surface-variant)" /></div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.login}</span>
                      {p.inClub && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: 'rgba(139,92,246,0.2)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>клуб</span>}
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.clubTitle ? p.clubTitle : 'Без клуба'}{p.elo != null ? ` · ELO ${Math.round(p.elo)}` : ''} · #{p.gomafiaId}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Sheet>

      {/* Модалка детали чека */}
      {checkModalId && (
        <div onClick={e => { if (e.target === e.currentTarget) setCheckModalId(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div className="glass-l1" style={{ width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto', borderRadius: 20, padding: 20 }}>
            {!checkDetail ? (
              <p style={{ textAlign: 'center', color: 'var(--on-surface-variant)', padding: '30px 0' }}>Загрузка…</p>
            ) : (() => {
              const ch = checkDetail.check ?? {}
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                    <div>
                      <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Чек</h3>
                      <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>{(ch.closedAt || ch.createdAt) ? new Date(ch.closedAt || ch.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</p>
                    </div>
                    <button onClick={() => setCheckModalId(null)} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer', flexShrink: 0 }}><Icon name="close" size={16} /></button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {(checkDetail.items ?? []).map((it: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--on-surface)', minWidth: 0 }}>{it.name} <span style={{ color: 'var(--on-surface-variant)' }}>×{it.quantity}</span></span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmt(it.lineTotal)} ₽</span>
                      </div>
                    ))}
                  </div>
                  {(checkDetail.discounts?.length ?? 0) > 0 && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {checkDetail.discounts.map((d: any) => (
                        <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#F59E0B' }}>
                          <span>Скидка: {d.name}</span><span>−{fmt(d.amount)} ₽</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, marginBottom: parseNum(ch.tipAmount) > 0 ? 6 : 12 }}>
                    <span style={{ fontSize: 14, color: 'var(--on-surface-variant)' }}>Итого</span>
                    <span style={{ fontSize: 20, fontWeight: 800 }}>{fmt(parseNum(ch.totalAmount))} ₽</span>
                  </div>
                  {parseNum(ch.tipAmount) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13, color: '#34D399', display: 'flex', alignItems: 'center', gap: 5 }}>💚 Чаевые (СБП)</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#34D399' }}>+{fmt(parseNum(ch.tipAmount))} ₽</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(checkDetail.payments ?? []).map((p: any, i: number) => (
                      <span key={i} style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}>{PAY_LABELS[p.method] ?? p.method}: {fmt(p.amount)} ₽</span>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Модалка начисления/списания (баланс/бонусы) */}
      {adjModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setAdjModal(null) }}
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="glass-l1" style={{ width: '100%', maxWidth: 380, borderRadius: 20, padding: 22 }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: '0 0 16px' }}>
              {adjModal.op === 'add' ? 'Начислить' : 'Списать'} {adjModal.kind === 'balance' ? '— баланс' : '— бонусы'}
            </h3>
            <label style={LBL}>Сумма {adjModal.kind === 'balance' ? '(₽)' : '(⭐)'}</label>
            <input type="number" inputMode="numeric" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} placeholder="0" autoFocus style={{ ...INP, marginBottom: 12 }} />
            <label style={LBL}>Комментарий</label>
            <input value={adjComment} onChange={e => setAdjComment(e.target.value)} placeholder="Причина (обязательно)" style={{ ...INP, marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setAdjModal(null)} style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--on-surface-variant)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Отмена</button>
              <button onClick={confirmAdj} disabled={!(Number(adjAmount) > 0) || adjComment.trim().length < 3}
                style={{ flex: 2, padding: '13px 0', borderRadius: 12, border: 'none', background: adjModal.op === 'add' ? 'linear-gradient(135deg,#10B981,#4cd7f6)' : 'linear-gradient(135deg,#F43F5E,#DC2626)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (!(Number(adjAmount) > 0) || adjComment.trim().length < 3) ? 0.5 : 1 }}>
                {adjModal.op === 'add' ? 'Начислить' : 'Списать'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={() => selected && update.mutate({ id: selected.id, deletedAt: new Date().toISOString() })}
        title="В архив?"
        message={`${selected?.nickname ?? 'Клиент'} будет перемещён в архив и скрыт из списка. Можно восстановить позже.`}
        confirmLabel="В архив"
        danger
        loading={update.isPending}
      />

      <ConfirmDialog
        open={confirmPurge}
        onClose={() => setConfirmPurge(false)}
        onConfirm={() => selected && purge.mutate(selected.id)}
        title="Удалить навсегда?"
        message={`${selected?.nickname ?? 'Клиент'} будет удалён безвозвратно. История чеков заведения сохранится, но будет обезличена. Это действие нельзя отменить.`}
        confirmLabel="Удалить навсегда"
        danger
        loading={purge.isPending}
      />

      <ConfirmDialog
        open={!!tgUnlinkTarget}
        onClose={() => setTgUnlinkTarget(null)}
        onConfirm={() => selected && tgUnlinkTarget && tgUnlinkMut.mutate({ id: selected.id, tgId: tgUnlinkTarget.tgId })}
        title="Отвязать аккаунт?"
        message={`Аккаунт ${tgUnlinkTarget ? (tgUnlinkTarget.username ? `@${tgUnlinkTarget.username}` : `id ${tgUnlinkTarget.tgId}`) : ''} больше не будет связан с этим профилем.`}
        confirmLabel="Отвязать"
        danger
        loading={tgUnlinkMut.isPending}
      />
    </div>
  )
}
