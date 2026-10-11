'use client'
/**
 * Единый раздел «Депозиты и долги»: дашборд + вкладки Все·Депозиты·Долги.
 * Депозит и долг — это ОДИН profiles.balance (плюс/минус), но управление раздельное:
 * в карточке клиента два блока действий — «Депозит» и «Долг» — со своими правилами.
 */
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Icon } from '@/components/Icon'
import { PageHeader, Sheet, Button, INP, LBL, formatMoney } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'

const CYAN = '#06B6D4' // депозит
const RED = '#F43F5E'  // долг

type Tab = 'all' | 'deposits' | 'debts'
type OpMode = null | 'deposit_add' | 'deposit_sub' | 'debt_repay' | 'debt_lend'
// Чем прошли деньги: наличные сервер проводит через кассу смены. «В долг» — без денег.
type PayMethod = 'cash' | 'transfer' | 'card'
const METHODS: [PayMethod, string][] = [['cash', 'Наличные'], ['transfer', 'Перевод'], ['card', 'Карта']]

function parseNum(v: unknown) { return parseFloat(String(v ?? 0)) || 0 }
function fmt(n: number) { return n.toLocaleString('ru', { maximumFractionDigits: 0 }) }
function initials(s?: string | null) { return (s ?? '?').slice(0, 2).toUpperCase() }
// Эффективное фото: ручное → Telegram → GoMafia.
const avatarUrl = (c: any): string | null => c?.photoUrl || c?.tgPhotoUrl || c?.gomafiaPhotoUrl || null
function isTab(v: string | null): v is Tab { return v === 'all' || v === 'deposits' || v === 'debts' }
function colorOf(balance: number) { return balance > 0 ? CYAN : balance < 0 ? RED : 'var(--on-surface-variant)' }

const OPS: Record<Exclude<OpMode, null>, { title: string; accent: string; defaultReason: string }> = {
  deposit_add: { title: 'Пополнить депозит', accent: '#10B981', defaultReason: 'Пополнение депозита' },
  deposit_sub: { title: 'Снять с депозита',  accent: RED,       defaultReason: 'Списание депозита' },
  debt_repay:  { title: 'Погасить долг',     accent: '#10B981', defaultReason: 'Погашение долга' },
  debt_lend:   { title: 'Выдать в долг',     accent: RED,       defaultReason: 'Долг (ручное начисление)' },
}

export default function BalancesPage() {
  const qc = useQueryClient()
  const { show } = useToast()

  const [tab, setTab] = useState<Tab>('all')
  const [selected, setSelected] = useState<any>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [opMode, setOpMode] = useState<OpMode>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<PayMethod>('cash')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (isTab(t)) setTab(t)
  }, [])
  function changeTab(t: Tab) {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const { data, isLoading } = useQuery<{ clients: any[] }>({
    queryKey: ['clients-balances'],
    queryFn: () => api.get('/clients?filter=balances'),
  })
  const all = data?.clients ?? []
  const deposits = all.filter(c => parseNum(c.balance) > 0)
  const debts = all.filter(c => parseNum(c.balance) < 0)
  const depositTotal = deposits.reduce((s, c) => s + parseNum(c.balance), 0)
  const debtTotal = debts.reduce((s, c) => s + Math.abs(parseNum(c.balance)), 0)
  const net = depositTotal - debtTotal
  const list = tab === 'deposits' ? deposits : tab === 'debts' ? debts : all

  // История денежных операций выбранного клиента.
  const { data: txData } = useQuery<{ transactions: any[] }>({
    queryKey: ['client-tx', selected?.id],
    queryFn: () => api.get(`/clients/${selected.id}/transactions`),
    enabled: !!selected?.id,
  })
  const history = (txData?.transactions ?? []).filter((t: any) => t.type === 'deposit' || t.type === 'withdrawal')

  // Поиск клиента для добавления.
  useEffect(() => {
    if (!showAdd) return
    if (timer.current) clearTimeout(timer.current)
    const q = search.trim()
    if (!q) { setResults([]); setSearching(false); return }
    setSearching(true)
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get<{ clients: any[] }>(`/clients?search=${encodeURIComponent(q)}`)
        setResults(res.clients ?? [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [search, showAdd])

  const adjust = useMutation({
    mutationFn: ({ id, amount, reason, idempotencyKey, method }: { id: string; amount: number; reason: string; idempotencyKey: string; method?: PayMethod }) =>
      api.post<{ balance: number; cashOperation?: { id: string } | null }>(`/clients/${id}/balance`, { amount, reason, idempotencyKey, method }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ['clients-balances'] })
      qc.invalidateQueries({ queryKey: ['client-tx', vars.id] })
      setSelected((s: any) => s ? { ...s, balance: parseNum(s.balance) + parseNum(vars.amount) } : s)
      setOpMode(null); setAmount(''); setReason('')
      if (vars.method === 'cash') {
        // Наличные изменили ожидаемый остаток кассы смены.
        qc.invalidateQueries({ queryKey: ['cashops'] })
        qc.invalidateQueries({ queryKey: ['shifts', 'cash-balance'] })
        qc.invalidateQueries({ queryKey: ['pos', 'shift-summary'] })
        if (!r?.cashOperation) { show('Баланс обновлён, но смена не открыта — наличные в кассу не записаны', 'warning'); return }
      }
      show('Баланс обновлён', 'success')
    },
    onError: (e: any) => show(e?.message || 'Не удалось изменить баланс', 'error'),
  })

  function openDetail(c: any) { setSelected(c); setOpMode(null); setAmount(''); setReason('') }
  function pickClient(c: any) { setShowAdd(false); setSearch(''); setResults([]); openDetail(c) }
  function startOp(mode: Exclude<OpMode, null>) { setOpMode(mode); setAmount(''); setReason(''); setMethod('cash') }

  function submitOp() {
    if (!selected || !opMode) return
    const v = parseFloat(amount)
    if (!(v > 0)) return
    const bal = parseNum(selected.balance)
    const deposit = bal > 0 ? bal : 0
    const debt = bal < 0 ? -bal : 0
    // Депозит-операции не пересекают ноль в долг и наоборот (раздельный контроль).
    let signed: number
    if (opMode === 'deposit_add') signed = v
    else if (opMode === 'deposit_sub') signed = -Math.min(v, deposit)
    else if (opMode === 'debt_repay') signed = Math.min(v, debt)
    else signed = -v // debt_lend (серверный лимит долга)
    if (signed === 0) return
    adjust.mutate({
      id: selected.id, amount: signed, reason: reason.trim() || OPS[opMode].defaultReason, idempotencyKey: crypto.randomUUID(),
      method: opMode === 'debt_lend' ? undefined : method,
    })
  }

  const bal = selected ? parseNum(selected.balance) : 0
  const hasDeposit = bal > 0
  const hasDebt = bal < 0

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Депозиты и долги"
        subtitle={net !== 0 ? `Сальдо ${formatMoney(net)}` : 'Балансы клиентов'}
        action={{ label: 'Добавить', icon: 'person_add', onClick: () => { setShowAdd(true); setSearch(''); setResults([]) } }}
      />

      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', flex: 1, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Дашборд */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <button onClick={() => changeTab('deposits')} className="glass-l2" style={{ borderRadius: 16, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', border: tab === 'deposits' ? `1px solid ${CYAN}88` : '1px solid rgba(255,255,255,0.08)' }}>
            <Icon name="savings" size={20} color={CYAN} />
            <p style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 0', color: CYAN, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(depositTotal)} ₽</p>
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>Депозиты · {deposits.length}</p>
          </button>
          <button onClick={() => changeTab('debts')} className="glass-l2" style={{ borderRadius: 16, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', border: tab === 'debts' ? `1px solid ${RED}88` : '1px solid rgba(255,255,255,0.08)' }}>
            <Icon name="money_off" size={20} color={RED} />
            <p style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 0', color: RED, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(debtTotal)} ₽</p>
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>Долги · {debts.length}</p>
          </button>
        </div>

        {/* Вкладки */}
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
          {([['all', 'Все'], ['deposits', 'Депозиты'], ['debts', 'Долги']] as [Tab, string][]).map(([key, label]) => {
            const active = tab === key
            return (
              <button key={key} onClick={() => changeTab(key)} style={{ flex: 1, padding: '10px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all 0.15s', background: active ? 'var(--primary-violet)' : 'transparent', color: active ? '#fff' : 'var(--on-surface-variant)' }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* Список */}
        {isLoading && !data ? (
          <StateView state="loading" />
        ) : list.length === 0 ? (
          <StateView state="empty" icon="account_balance_wallet" title={tab === 'debts' ? 'Должников нет' : tab === 'deposits' ? 'Нет депозитов' : 'Нет балансов'} description="Нажмите «Добавить», чтобы найти клиента и изменить его баланс." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map((c: any) => {
              const cb = parseNum(c.balance)
              const col = colorOf(cb)
              return (
                <div key={c.id} className="glass-l2" onClick={() => openDetail(c)}
                  style={{ position: 'relative', overflow: 'hidden', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                  {avatarUrl(c)
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarUrl(c)!} alt="" width={46} height={46} style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: `2px solid ${col}55` }} />
                    : <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0, background: `${col}22`, border: `2px solid ${col}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: col }}>
                        {initials(c.nickname)}
                      </div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{c.nickname}</p>
                    <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>{c.fullName || c.phone || 'Без контакта'}</p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: col, margin: 0, fontFamily: "'JetBrains Mono',monospace" }}>{formatMoney(cb)}</p>
                    <p style={{ fontSize: 10, color: 'var(--on-surface-variant)', margin: '1px 0 0' }}>{cb > 0 ? 'депозит' : 'долг'}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Добавить клиента (поиск) */}
      <Sheet open={showAdd} onClose={() => setShowAdd(false)} title="Найти клиента">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Имя или ник клиента" style={INP} />
          {searching && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>Поиск…</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {results.map((c: any) => {
              const cb = parseNum(c.balance); const col = colorOf(cb)
              return (
                <button key={c.id} type="button" onClick={() => pickClient(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left' }}>
                  {avatarUrl(c)
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarUrl(c)!} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
                    : <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: `${col}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: col }}>{initials(c.nickname)}</div>}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nickname}</p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>Баланс: {formatMoney(cb)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </Sheet>

      {/* Единая карточка клиента */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} initialHeight="88dvh" maxHeight="94dvh">
        {selected && (() => {
          const col = colorOf(bal)
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Инфо о клиенте */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {avatarUrl(selected)
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarUrl(selected)!} alt="" width={56} height={56} style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: `2px solid ${col}55` }} />
                  : <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, background: `${col}22`, border: `2px solid ${col}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: col }}>
                      {initials(selected.nickname)}
                    </div>}
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{selected.nickname}</h2>
                  {selected.fullName ? <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{selected.fullName}</p> : null}
                  {selected.phone ? <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{selected.phone}</p> : null}
                </div>
              </div>

              {/* Текущий баланс */}
              <div className="glass-l2" style={{ borderRadius: 16, padding: '14px 16px', textAlign: 'center', border: `1px solid ${col}33` }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>{hasDeposit ? 'Депозит' : hasDebt ? 'Долг' : 'Баланс'}</p>
                <p style={{ fontSize: 30, fontWeight: 900, color: col, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {hasDebt ? `${fmt(-bal)} ₽` : formatMoney(bal)}
                </p>
              </div>

              {/* Форма операции ИЛИ два блока действий */}
              {opMode ? (
                <div className="glass-l2" style={{ borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: OPS[opMode].accent }}>{OPS[opMode].title}</p>
                  <div><label style={LBL}>Сумма (₽)</label>
                    <input type="number" inputMode="decimal" min="0" autoFocus value={amount} onChange={e => setAmount(e.target.value)} placeholder="например 1000" style={INP} /></div>
                  {opMode !== 'debt_lend' && (
                    <div><label style={LBL}>Способ</label>
                      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        {METHODS.map(([key, label]) => {
                          const active = method === key
                          return (
                            <button key={key} type="button" onClick={() => setMethod(key)} style={{ flex: 1, padding: '10px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all 0.15s', background: active ? 'var(--primary-violet)' : 'transparent', color: active ? '#fff' : 'var(--on-surface-variant)' }}>
                              {label}
                            </button>
                          )
                        })}
                      </div></div>
                  )}
                  <div><label style={LBL}>Причина (необязательно)</label>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder={OPS[opMode].defaultReason} style={INP} /></div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                    <Button variant="ghost" fullWidth onClick={() => { setOpMode(null); setAmount(''); setReason('') }}>Отмена</Button>
                    <Button fullWidth loading={adjust.isPending} disabled={!(parseFloat(amount) > 0)} onClick={submitOp}>{OPS[opMode].title}</Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Блок Депозит */}
                  <div style={{ borderRadius: 16, padding: 14, background: `${CYAN}0d`, border: `1px solid ${CYAN}33` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Icon name="savings" size={17} color={CYAN} />
                      <span style={{ fontSize: 13, fontWeight: 800, color: CYAN }}>Депозит</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => startOp('deposit_add')}
                        style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Icon name="add" size={17} color="#fff" /> Пополнить
                      </button>
                      <button onClick={() => startOp('deposit_sub')} disabled={!hasDeposit}
                        style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: `1px solid ${RED}55`, cursor: hasDeposit ? 'pointer' : 'not-allowed', background: `${RED}14`, color: RED, fontSize: 14, fontWeight: 800, opacity: hasDeposit ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Icon name="remove" size={17} color={RED} /> Снять
                      </button>
                    </div>
                  </div>

                  {/* Блок Долг */}
                  <div style={{ borderRadius: 16, padding: 14, background: `${RED}0d`, border: `1px solid ${RED}33` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Icon name="money_off" size={17} color={RED} />
                      <span style={{ fontSize: 13, fontWeight: 800, color: RED }}>Долг</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => startOp('debt_repay')} disabled={!hasDebt}
                        style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', cursor: hasDebt ? 'pointer' : 'not-allowed', background: 'linear-gradient(135deg, #10B981, #059669)', color: '#fff', fontSize: 14, fontWeight: 800, opacity: hasDebt ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Icon name="check" size={17} color="#fff" /> Погасить
                      </button>
                      <button onClick={() => startOp('debt_lend')}
                        style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: `1px solid ${RED}55`, cursor: 'pointer', background: `${RED}14`, color: RED, fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Icon name="add" size={17} color={RED} /> Выдать в долг
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* История */}
              <div>
                <p style={{ ...LBL, marginBottom: 10 }}>История</p>
                {history.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'rgba(204,195,216,0.4)', textAlign: 'center', padding: '16px 0' }}>Пока нет операций</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {history.map((tx: any) => {
                      const credit = tx.type === 'deposit'
                      const amt = parseNum(tx.amount)
                      return (
                        <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{tx.description || (credit ? 'Начисление' : 'Списание')}</p>
                            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{tx.createdAt ? formatDistanceToNow(new Date(tx.createdAt), { locale: ru, addSuffix: true }) : ''}</p>
                          </div>
                          <p style={{ fontSize: 14, fontWeight: 800, color: credit ? '#10B981' : RED, margin: 0, fontFamily: "'JetBrains Mono',monospace" }}>
                            {credit ? '+' : '−'}{fmt(amt)} ₽
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        })()}
      </Sheet>
    </div>
  )
}
