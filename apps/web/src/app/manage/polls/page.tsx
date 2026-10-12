'use client'
/**
 * Экран «Опросы» — настройка регулярных Telegram-опросов клуба.
 *
 * Tai (бот клуба, интеграция poll_bot_token) — опросы управляются по образцу
 * вкладки «Интеграции»: маска + явная замена/удаление. Сами опросы хранятся
 * целиком как массив конфигов; бэк постит их по расписанию (дни + время МСК).
 */
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api'
import { Icon } from '@/components/Icon'
import {
  PageHeader, SectionGroup, FormField, INP, SEL, LBL, Toggle, Button, IconButton,
  Chip, ConfirmDialog, SaveButton, Sheet,
} from '@/components/manage/DesignSystem'
import { useToast } from '@/components/Toast'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface PollConfig {
  id: string
  kind: string
  enabled: boolean
  chatId: string
  threadId: number | null
  title: string
  subtitleDay: string
  autoDay?: boolean
  subtitleTime: string
  options: string[]
  weekdays: number[] // 1=Пн..7=Вс — ДНИ ПОСТИНГА
  postTime: string // "HH:MM" МСК
  lastPostedAt?: string | null
}

interface PollsResponse {
  configs: PollConfig[]
  tokenConfigured: boolean
  tokenMasked: string | null
  commandsAdminOnly: boolean
}

// Группа/топик, «увиденные» ботом (для выбора вместо ручного ввода ID).
interface ChatItem {
  id: string
  title: string | null
  type: string | null
  topics: { threadId: string; name: string | null }[]
}

// ─── Константы ──────────────────────────────────────────────────────────────

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Пн' }, { value: 2, label: 'Вт' }, { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' }, { value: 5, label: 'Пт' }, { value: 6, label: 'Сб' },
  { value: 7, label: 'Вс' },
]

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
const DEFAULT_OPTIONS = ['Да', 'Нет', 'Думаю', 'Опоздаю']

// Стандартные опросы для префилла пустого списка.
function buildDefaults(): PollConfig[] {
  return [
    {
      id: crypto.randomUUID(), kind: 'sport', enabled: false,
      chatId: '-1001281350483', threadId: 127961,
      title: 'Спортивная мафия', subtitleDay: 'Пятница', autoDay: true, subtitleTime: '20:00',
      options: [...DEFAULT_OPTIONS], weekdays: [], postTime: '10:00',
    },
    {
      id: crypto.randomUUID(), kind: 'city', enabled: false,
      chatId: '-1002018963369', threadId: 67316,
      title: 'Городская мафия', subtitleDay: '', autoDay: true, subtitleTime: '',
      options: [...DEFAULT_OPTIONS], weekdays: [], postTime: '10:00',
    },
  ]
}

function emptyConfig(): PollConfig {
  return {
    id: crypto.randomUUID(), kind: 'custom', enabled: false,
    chatId: '', threadId: null,
    title: '', subtitleDay: '', autoDay: true, subtitleTime: '',
    options: [...DEFAULT_OPTIONS], weekdays: [], postTime: '10:00',
  }
}

function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

// ─── Экран ──────────────────────────────────────────────────────────────────

export default function PollsPage() {
  const router = useRouter()
  const { show } = useToast()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<PollConfig[]>([])
  const [tokenConfigured, setTokenConfigured] = useState(false)
  const [tokenMasked, setTokenMasked] = useState<string | null>(null)

  // Токен Tai задан — без него Tai не видит чаты.
  const [collectTokenConfigured, setCollectTokenConfigured] = useState(false)

  // Команды-отметки: только админы (по умолчанию) или любой участник.
  const [commandsAdminOnly, setCommandsAdminOnly] = useState(true)
  const [commandsBusy, setCommandsBusy] = useState(false)

  // Группы/топики, «увиденные» ботом — для выбора в модалке «Куда постить».
  const [chats, setChats] = useState<ChatItem[]>([])
  const [chatsBusy, setChatsBusy] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Удаление опроса (подтверждение).
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Тест: id опроса, который сейчас отправляется.
  const [testingId, setTestingId] = useState<string | null>(null)
  // «Выложить на сегодня»: id опроса, который сейчас публикуется.
  const [postingTodayId, setPostingTodayId] = useState<string | null>(null)

  // Редактирование группы/топика опроса вынесено за модалку — чтобы не сбить
  // случайно (опрос уйдёт не туда). Токен бота настраивается в разделе «Интеграции».
  const [groupEditId, setGroupEditId] = useState<string | null>(null)

  // ── Загрузка ───────────────────────────────────────────────────────────────
  async function load() {
    setLoadError(null)
    try {
      const res = await api.get<PollsResponse>('/system/polls')
      // Если список пуст — предзаполняем стандартными опросами (это лишь форма,
      // сохранится при «Сохранить»).
      setConfigs(res.configs.length > 0 ? res.configs : buildDefaults())
      setTokenConfigured(res.tokenConfigured)
      setTokenMasked(res.tokenMasked)
      setCommandsAdminOnly(res.commandsAdminOnly !== false)
      // Состояние сбора участников — отдельная подписка; ошибку не роняем на весь экран.
      try {
        const c = await api.get<{ enabled: boolean; tokenConfigured: boolean }>('/system/polls/collect')
        setCollectTokenConfigured(c.tokenConfigured)
      } catch { /* статус сбора недоступен — оставляем дефолты */ }
      // Список «увиденных» групп/топиков — для выбора в модалке (не критичен).
      loadChats()
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Не удалось загрузить опросы')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ── Обновление одного конфига ────────────────────────────────────────────────
  function patchConfig(id: string, patch: Partial<PollConfig>) {
    setConfigs(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
    setSaved(false)
  }

  function addConfig() {
    setConfigs(prev => [...prev, emptyConfig()])
    setSaved(false)
  }

  function removeConfig(id: string) {
    setConfigs(prev => prev.filter(c => c.id !== id))
    setDeletingId(null)
    setSaved(false)
  }

  // ── Валидация ────────────────────────────────────────────────────────────────
  function validate(): string | null {
    for (const c of configs) {
      const name = c.title.trim() || 'опрос без названия'
      if (!c.title.trim()) return 'У всех опросов должен быть заголовок'
      if (!c.chatId.trim()) return `«${name}»: укажите ID группы`
      const opts = c.options.map(o => o.trim()).filter(Boolean)
      if (opts.length < 2) return `«${name}»: нужно минимум 2 варианта ответа`
      if (!TIME_RE.test(c.postTime.trim())) return `«${name}»: время постинга в формате ЧЧ:ММ`
    }
    return null
  }

  // Нормализуем конфиги перед отправкой (чистим пустые варианты).
  function normalized(): PollConfig[] {
    return configs.map(c => ({
      ...c,
      title: c.title.trim(),
      chatId: c.chatId.trim(),
      postTime: c.postTime.trim(),
      options: c.options.map(o => o.trim()).filter(Boolean),
    }))
  }

  // ── Сохранение всех конфигов ─────────────────────────────────────────────────
  async function saveAll(): Promise<boolean> {
    const err = validate()
    if (err) { show(err, 'error'); return false }
    setSaving(true)
    try {
      const res = await api.put<{ ok: boolean; configs: PollConfig[] }>('/system/polls', { configs: normalized() })
      // Бэк мерджит lastPostedAt — берём свежие конфиги из ответа.
      if (res.configs) setConfigs(res.configs)
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
      return true
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'Не удалось сохранить', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function onSave() {
    const ok = await saveAll()
    if (ok) show('Сохранено', 'success')
  }

  // ── Тест: сначала сохраняем (опрос должен быть на бэке), затем отправляем ─────
  async function onTest(id: string) {
    if (!tokenConfigured) { show('Сначала настройте токен Tai', 'error'); return }
    setTestingId(id)
    try {
      const ok = await saveAll()
      if (!ok) return
      await api.post<{ ok: boolean; messageId: number }>('/system/polls/test', { id })
      show('Опрос отправлен', 'success')
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'Бот не в группе или нет прав', 'error')
    } finally {
      setTestingId(null)
    }
  }

  // ── «Выложить на сегодня»: сохраняем, затем постим с СЕГОДНЯШНИМ днём недели ───
  // День в подзаголовке = день выкладки, независимо от настройки autoDay опроса
  // (для «Спортивной»/«Городской» мафии и любого другого опроса по его заголовку).
  async function onPostToday(id: string) {
    if (!tokenConfigured) { show('Сначала настройте токен Tai', 'error'); return }
    setPostingTodayId(id)
    try {
      const ok = await saveAll()
      if (!ok) return
      await api.post<{ ok: boolean; messageId: number }>('/system/polls/post-today', { id })
      show('Опрос на сегодня выложен', 'success')
      await load() // обновить «последняя отправка» (lastPostedAt с сервера)
    } catch (e) {
      show(e instanceof ApiError ? e.message : 'Бот не в группе или нет прав', 'error')
    } finally {
      setPostingTodayId(null)
    }
  }

  // ── Кто может слать команды-отметки (только админ / любой участник) ───────────
  async function toggleCommandsAdminOnly(next: boolean) {
    if (commandsBusy) return
    setCommandsBusy(true)
    const prev = commandsAdminOnly
    setCommandsAdminOnly(next) // оптимистично
    try {
      await api.post('/system/polls/commands', { adminOnly: next })
      show(next ? 'Команды — только для админов' : 'Команды доступны всем участникам', 'success')
    } catch (e) {
      setCommandsAdminOnly(prev)
      show(e instanceof ApiError ? e.message : 'Не удалось сохранить настройку', 'error')
    } finally {
      setCommandsBusy(false)
    }
  }

  // ── Подтянуть «увиденные» ботом группы/топики ────────────────────────────────
  async function loadChats() {
    setChatsBusy(true)
    try {
      const res = await api.get<{ chats: ChatItem[] }>('/system/polls/chats')
      setChats(Array.isArray(res.chats) ? res.chats : [])
    } catch { /* список недоступен — выбор скрыт, ручной ввод остаётся */ }
    finally { setChatsBusy(false) }
  }

  // ── Загрузка / ошибка ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <PageHeader title="Опросы" subtitle="Регулярные опросы в Telegram" onBack={() => router.push('/manage')} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-variant)' }}>
          <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        <PageHeader title="Опросы" subtitle="Регулярные опросы в Telegram" onBack={() => router.push('/manage')} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Icon name="cancel" size={32} color="var(--danger)" />
          <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', textAlign: 'center', margin: 0 }}>{loadError}</p>
          <Button variant="secondary" icon="refresh" onClick={() => { setLoading(true); load() }}>Повторить</Button>
        </div>
      </div>
    )
  }

  const groupCfg = configs.find(c => c.id === groupEditId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PageHeader title="Опросы" subtitle="Регулярные опросы в Telegram" onBack={() => router.push('/manage')} />

      <div style={{
        padding: '20px 16px var(--bottom-nav-clear, 24px)',
        maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>

        {/* ─── Статус Tai (токен — в разделе «Интеграции») ──────── */}
        <div
          className="glass-l2"
          style={{
            borderRadius: 16, padding: 14, display: 'flex', alignItems: 'center', gap: 12,
            ...(tokenConfigured ? {} : { background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }),
          }}
        >
          <Icon
            name={tokenConfigured ? 'campaign' : 'warning'}
            size={20}
            color={tokenConfigured ? 'var(--success)' : 'var(--warning)'}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {tokenConfigured ? (
              <p style={{ fontSize: 13, margin: 0, color: 'var(--on-surface)', lineHeight: 1.5 }}>
                Tai подключён{tokenMasked ? <> • <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{tokenMasked}</span></> : ''}. Бот должен быть <b>админом</b> в группах. Токен — в разделе «Интеграции».
              </p>
            ) : (
              <p style={{ fontSize: 13, margin: 0, color: 'var(--on-surface)', lineHeight: 1.5 }}>
                Токен Tai не настроен — задайте его в <b>Настройки → Интеграции</b>, иначе опросы не отправятся. Бот также должен быть админом в группах.
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" icon="settings" onClick={() => router.push('/manage/settings?tab=integrations')}>
            Интеграции
          </Button>
        </div>

        {/* ─── Сбор участников из чата ────────────────────────────────────── */}
        <SectionGroup title="Участники чатов">
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!collectTokenConfigured && (
              <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0 }}>Сначала задайте токен Tai в «Интеграции»</p>
            )}
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
              Tai всегда собирает тех, кто голосует в опросах и пишет в чат (бот должен быть админом). Полный список участников Telegram не отдаёт — список пополняется по мере активности. Сопоставление — в карточке клиента, кнопка «Сопоставить из чата».
            </p>
            <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px', color: 'var(--on-surface)' }}>Команды бота в чате:</p>
              <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.6 }}>
                <b style={{ color: 'var(--on-surface)' }}>@all</b> — отметить всех известных участников чата.<br />
                <b style={{ color: 'var(--on-surface)' }}>@tvari</b> — не проголосовавшие <b>+ выбравшие «Думаю»</b> в последнем опросе.<br />
                <b style={{ color: 'var(--on-surface)' }}>@supertvari</b> — выбравшие <b>«Нет»</b> в последнем опросе.
              </p>
              <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '6px 0 0', lineHeight: 1.4 }}>
                Работают, когда сбор включён и бот — админ чата. Считаются по последнему опросу В ЭТОЙ группе, в реальном времени. Каждую команду один человек может отправлять не чаще раза в 10 минут. Отмечаются только «увиденные» ботом участники.
              </p>

              {/* Кто может слать команды */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: 'var(--on-surface)' }}>Только администраторы чата</p>
                  <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0', lineHeight: 1.4 }}>
                    {commandsAdminOnly
                      ? 'Команды доступны только админам группы.'
                      : 'Команды может отправлять любой участник чата.'}
                  </p>
                </div>
                <Toggle value={commandsAdminOnly} onChange={v => { if (!commandsBusy) toggleCommandsAdminOnly(v) }} ariaLabel="Команды только для админов" />
              </div>
            </div>
          </div>
        </SectionGroup>

        {/* ─── Список опросов ────────────────────────────────────────────── */}
        {configs.map(c => {
          const isTesting = testingId === c.id
          const isPostingToday = postingTodayId === c.id
          const busyAny = testingId !== null || postingTodayId !== null
          return (
            <SectionGroup key={c.id} title={c.title.trim() || 'Новый опрос'}>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Шапка: заголовок + вкл + удалить */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <FormField label="Заголовок">
                      <input style={INP} value={c.title}
                        onChange={e => patchConfig(c.id, { title: e.target.value })}
                        placeholder="Например, Спортивная мафия" />
                    </FormField>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingBottom: 2 }}>
                    <span style={{ ...LBL, margin: 0 }}>Вкл</span>
                    <Toggle value={c.enabled} onChange={v => patchConfig(c.id, { enabled: v })} ariaLabel="Включён" />
                  </div>
                  <IconButton icon="delete" variant="danger" ariaLabel="Удалить опрос"
                    onClick={() => setDeletingId(c.id)} style={{ marginBottom: 1 }} />
                </div>

                {/* Куда постить (группа + топик) — за модалкой, чтобы не сбить случайно */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <Icon name="forum" size={18} color="var(--on-surface-variant)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...LBL, margin: 0 }}>Куда постить</p>
                    <p style={{
                      fontSize: 13, margin: '2px 0 0',
                      color: c.chatId ? 'var(--on-surface)' : 'var(--warning)',
                      fontFamily: c.chatId ? "'JetBrains Mono',monospace" : undefined,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.chatId ? `${c.chatId}${c.threadId ? ` · топик ${c.threadId}` : ''}` : 'Группа не указана'}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setGroupEditId(c.id)}>
                    Изменить
                  </Button>
                </div>

                {/* Подзаголовок: день (авто/статичный) + время */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ ...LBL, margin: 0 }}>День недели — по дню выкладки</p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0', lineHeight: 1.4 }}>
                      Авто-подстановка (Пн–Вс) в день отправки опроса.
                    </p>
                  </div>
                  <Toggle value={c.autoDay !== false} onChange={v => patchConfig(c.id, { autoDay: v })} ariaLabel="Авто день недели" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: c.autoDay !== false ? '1fr' : '1fr 1fr', gap: 12 }}>
                  {c.autoDay === false && (
                    <FormField label="Подзаголовок — день">
                      <input style={INP} value={c.subtitleDay}
                        onChange={e => patchConfig(c.id, { subtitleDay: e.target.value })}
                        placeholder="Пятница" />
                    </FormField>
                  )}
                  <FormField
                    label="Время мероприятия — в опросе"
                    hint="Показывается в ТЕКСТЕ опроса рядом с днём (напр. «Четверг 20:00»). Пусто — времени в опросе не будет."
                  >
                    <input style={INP} value={c.subtitleTime}
                      onChange={e => patchConfig(c.id, { subtitleTime: e.target.value })}
                      placeholder="20:00" />
                  </FormField>
                </div>
                <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '-8px 0 0', lineHeight: 1.45 }}>
                  {c.autoDay !== false
                    ? 'Напр.: «Спортивная мафия / Среда 20:00» — день = день выкладки.'
                    : 'Показывается в опросе под заголовком (статичный текст).'}
                </p>

                {/* Варианты ответов */}
                <div>
                  <label style={LBL}>Варианты ответов</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {c.options.map((opt, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input style={INP} value={opt}
                          onChange={e => {
                            const next = [...c.options]
                            next[i] = e.target.value
                            patchConfig(c.id, { options: next })
                          }}
                          placeholder={`Вариант ${i + 1}`} />
                        <IconButton icon="delete" variant="ghost" ariaLabel={`Удалить вариант ${i + 1}`}
                          disabled={c.options.length <= 2}
                          onClick={() => patchConfig(c.id, { options: c.options.filter((_, j) => j !== i) })} />
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Button variant="secondary" size="sm" icon="add"
                      disabled={c.options.length >= 10}
                      onClick={() => patchConfig(c.id, { options: [...c.options, ''] })}>
                      Добавить вариант
                    </Button>
                  </div>
                </div>

                {/* Дни постинга */}
                <div>
                  <label style={LBL}>Дни постинга</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {WEEKDAYS.map(d => {
                      const active = c.weekdays.includes(d.value)
                      return (
                        <Chip key={d.value} active={active}
                          onClick={() => {
                            const next = active
                              ? c.weekdays.filter(w => w !== d.value)
                              : [...c.weekdays, d.value].sort((a, b) => a - b)
                            patchConfig(c.id, { weekdays: next })
                          }}>
                          {d.label}
                        </Chip>
                      )
                    })}
                  </div>
                </div>

                {/* Время постинга */}
                <FormField label="Время постинга (МСК)" hint="Когда бот САМ публикует опрос в выбранные дни. В тексте опроса НЕ показывается (для времени в опросе — поле «Время мероприятия» выше). Формат ЧЧ:ММ.">
                  <input style={INP} value={c.postTime}
                    onChange={e => patchConfig(c.id, { postTime: e.target.value })}
                    placeholder="10:00" inputMode="numeric" />
                </FormField>

                {/* Выложить на сегодня + тест + последняя отправка */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Реальная выкладка с сегодняшним днём недели (день = день выкладки),
                      независимо от настройки «авто-день» опроса. */}
                  <Button variant="primary" icon="campaign" fullWidth
                    loading={isPostingToday} disabled={!tokenConfigured || busyAny}
                    onClick={() => onPostToday(c.id)}>
                    Выложить на сегодня
                  </Button>
                  <Button variant="secondary" icon="send" fullWidth
                    loading={isTesting} disabled={!tokenConfigured || busyAny}
                    onClick={() => onTest(c.id)}>
                    Отправить сейчас (тест)
                  </Button>
                  {c.lastPostedAt && (
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0, textAlign: 'center' }}>
                      Последняя отправка: {fmtDateTime(c.lastPostedAt)}
                    </p>
                  )}
                </div>
              </div>
            </SectionGroup>
          )
        })}

        {/* ─── Добавить опрос ─────────────────────────────────────────────── */}
        <Button variant="secondary" icon="add" fullWidth onClick={addConfig}>
          Добавить опрос
        </Button>

        {/* ─── Сохранить ──────────────────────────────────────────────────── */}
        <SaveButton onClick={onSave} isPending={saving} isSaved={saved} />
      </div>

      {/* ─── Sheet: группа и топик опроса (анти-случайность) ──────────────── */}
      <Sheet open={groupEditId !== null} onClose={() => setGroupEditId(null)} title="Куда постить" desktopSize="sm">
        {groupCfg && (() => {
          // Группы из «увиденных» ботом (личку отфильтровал бэк). Текущая группа,
          // если бот её видел, — для списка топиков.
          const curChat = chats.find(ch => ch.id === groupCfg.chatId) ?? null
          const knownSelected = curChat !== null
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              display: 'flex', gap: 10, padding: 14, borderRadius: 12,
              background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)',
            }}>
              <Icon name="warning" size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 13, margin: 0, color: 'var(--on-surface)', lineHeight: 1.5 }}>
                Меняйте осторожно: неверный ID группы или топик отправят опрос не туда (или с ошибкой). Изменение применится после «Сохранить».
              </p>
            </div>

            {/* Выбор из «увиденных» ботом групп/топиков */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <p style={{ ...LBL, margin: 0 }}>Выбрать из чатов бота</p>
                <IconButton icon="refresh" variant="ghost" ariaLabel="Обновить список чатов"
                  disabled={chatsBusy} onClick={loadChats} />
              </div>

              {chats.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
                  Бот пока не видел групп. Добавьте Tai админом в группу и напишите туда сообщение — затем нажмите обновить. Telegram не отдаёт список групп заранее.
                </p>
              ) : (
                <>
                  <FormField label="Группа">
                    <select
                      style={SEL}
                      value={knownSelected ? groupCfg.chatId : ''}
                      onChange={e => {
                        const v = e.target.value
                        if (v) patchConfig(groupCfg.id, { chatId: v, threadId: null })
                      }}
                    >
                      <option value="">{knownSelected ? '— выбрать группу —' : '— не из списка (вручную ниже) —'}</option>
                      {chats.map(ch => (
                        <option key={ch.id} value={ch.id}>
                          {(ch.title || 'Без названия')} · {ch.id}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {curChat && curChat.topics.length > 0 && (
                    <FormField label="Топик">
                      <select
                        style={SEL}
                        value={groupCfg.threadId != null ? String(groupCfg.threadId) : ''}
                        onChange={e => {
                          const raw = e.target.value
                          patchConfig(groupCfg.id, { threadId: raw === '' ? null : Number(raw) })
                        }}
                      >
                        <option value="">Общий чат (без топика)</option>
                        {curChat.topics.map(t => (
                          <option key={t.threadId} value={t.threadId}>
                            {t.name || `Топик ${t.threadId}`}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  )}
                  {curChat && curChat.topics.length === 0 && (
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.4 }}>
                      Топиков у этой группы бот не видел. Если группа — форум, напишите в нужном топике, чтобы бот его запомнил, либо укажите ID вручную ниже.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Ручной ввод (всегда доступен как запасной вариант) */}
            <FormField label="ID группы — вручную" hint="Например, -1001281350483 (из ссылки на группу).">
              <input style={INP} value={groupCfg.chatId}
                onChange={e => patchConfig(groupCfg.id, { chatId: e.target.value })}
                placeholder="-100…" inputMode="numeric" />
            </FormField>

            <FormField label="Топик (message_thread_id) — вручную" hint="Опционально. Пусто — отправка в общий чат группы.">
              <input style={INP} type="number" value={groupCfg.threadId ?? ''}
                onChange={e => {
                  const raw = e.target.value.trim()
                  patchConfig(groupCfg.id, { threadId: raw === '' ? null : Number(raw) })
                }}
                placeholder="Напр. 127961" />
            </FormField>

            <Button variant="primary" fullWidth icon="check_circle" onClick={() => setGroupEditId(null)}>
              Готово
            </Button>
          </div>
          )
        })()}
      </Sheet>

      {/* ─── Подтверждение удаления опроса ─────────────────────────────────── */}
      <ConfirmDialog
        open={deletingId !== null}
        onClose={() => setDeletingId(null)}
        onConfirm={() => deletingId && removeConfig(deletingId)}
        title="Удалить опрос?"
        message="Опрос будет удалён из списка. Изменение вступит в силу после сохранения."
        confirmLabel="Удалить"
        danger
      />
    </div>
  )
}
