'use client'
/**
 * «Сбор средств» — сборы взносов с резидентов (Фонд клуба + разовые), не связанные
 * с кассой заведения. Список сборов → детализация за период (ростер резидентов,
 * отметка оплаты по способам, исключения, персональные суммы).
 */
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PageHeader, Sheet, Button, ConfirmDialog, INP, LBL, Toggle, formatMoney } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Icon } from '@/components/Icon'

type Method = 'cash' | 'transfer' | 'sbp' | 'deposit' | 'debt'
const METHODS: { key: Method; label: string; color: string }[] = [
  { key: 'cash', label: 'Наличные', color: '#10B981' },
  { key: 'transfer', label: 'Перевод', color: '#3B82F6' },
  { key: 'sbp', label: 'СБП', color: '#8B5CF6' },
  { key: 'deposit', label: 'Депозит', color: '#06B6D4' },
  { key: 'debt', label: 'Долг', color: '#F43F5E' },
]
const methodMeta = (m: string) => METHODS.find(x => x.key === m) ?? { key: m, label: m, color: '#94A3B8' }
const TIER_META: Record<string, { label: string; color: string }> = {
  resident: { label: 'Резидент', color: '#8B5CF6' },
  student: { label: 'Студент', color: '#3B82F6' },
  newbie: { label: 'Новичок', color: '#22D3EE' },
}

function mskCurKey() { const d = new Date(Date.now() + 3 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function Avatar({ photoUrl, name, size = 40 }: { photoUrl?: string | null; name?: string | null; size?: number }) {
  const initials = (name ?? '').trim().replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.34), fontWeight: 800, color: '#cbb8f5', border: '1px solid rgba(255,255,255,0.09)', background: photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.4), rgba(76,215,246,0.3))' }}>
      {photoUrl
        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photoUrl} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : (initials || <Icon name="person" size={Math.round(size * 0.5)} color="rgba(204,195,216,0.6)" />)}
    </div>
  )
}

export default function CollectionsPage() {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  if (openId) return <CollectionDetail id={openId} onBack={() => setOpenId(null)} />
  return <CollectionsList onOpen={setOpenId} onBack={() => router.push('/manage')} />
}

/* ─── Список сборов ──────────────────────────────────────────────────────── */
function CollectionsList({ onOpen, onBack }: { onOpen: (id: string) => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [showForm, setShowForm] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<any>('/collections'),
  })
  const list: any[] = data?.collections ?? []

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Сбор средств" subtitle="Фонд клуба и разовые сборы · взносы резидентов" onBack={onBack}
        action={{ label: 'Создать', icon: 'add', onClick: () => setShowForm(true) }} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {isLoading ? <StateView state="loading" />
          : isError ? <StateView state="error" description="Не удалось загрузить сборы." action={{ label: 'Повторить', onClick: () => refetch() }} />
          : list.length === 0 ? <StateView state="empty" icon="savings" title="Пока нет сборов" description="Создайте «Фонд клуба» или разовый сбор." />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {list.map(cobj => (
                <button key={cobj.id} onClick={() => onOpen(cobj.id)} className="glass-l2"
                  style={{ textAlign: 'left', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'var(--on-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="savings" size={22} color="#22C55E" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cobj.name}</p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <Badge text={cobj.kind === 'recurring' ? 'Ежемесячный' : 'Разовый'} color="#8B5CF6" />
                        <Badge text={cobj.isMandatory ? 'Обязательный' : 'Добровольный'} color={cobj.isMandatory ? '#F59E0B' : '#10B981'} />
                      </div>
                    </div>
                    <Icon name="chevron_right" size={18} color="rgba(204,195,216,0.4)" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                    <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>
                      {cobj.period?.label ?? '—'} · оплатили <b style={{ color: 'var(--on-surface)' }}>{cobj.paidCount}</b> из {cobj.expectedCount}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#22C55E', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(cobj.collected)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
      </div>
      <CollectionForm open={showForm} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['collections'] }); show('Сбор создан') }} />
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${color}1f`, color, border: `1px solid ${color}33` }}>{text}</span>
}

/* ─── Форма создания/редактирования сбора ────────────────────────────────── */
function CollectionForm({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing?: any }) {
  const { show } = useToast()
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [kind, setKind] = useState<'recurring' | 'oneoff'>(editing?.kind ?? 'recurring')
  const [amount, setAmount] = useState<string>(editing ? String(editing.defaultAmount ?? '') : '')
  const [mandatory, setMandatory] = useState<boolean>(editing ? !!editing.isMandatory : true)

  // Сброс формы при открытии под другой объект.
  React.useEffect(() => {
    if (!open) return
    setName(editing?.name ?? ''); setDescription(editing?.description ?? '')
    setKind(editing?.kind ?? 'recurring'); setAmount(editing ? String(editing.defaultAmount ?? '') : '')
    setMandatory(editing ? !!editing.isMandatory : true)
  }, [open, editing])

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), description: description.trim() || null, defaultAmount: parseFloat(amount) || 0, isMandatory: mandatory }
      return editing ? api.patch(`/collections/${editing.id}`, body) : api.post('/collections', { ...body, kind })
    },
    onSuccess: onSaved,
    onError: () => show('Не удалось сохранить сбор', 'error'),
  })

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Редактировать сбор' : 'Новый сбор'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={LBL}>Название</label>
          <input style={INP} value={name} onChange={e => setName(e.target.value)} placeholder="Например: Фонд клуба" />
        </div>
        <div>
          <label style={LBL}>Описание (необязательно)</label>
          <input style={INP} value={description} onChange={e => setDescription(e.target.value)} placeholder="На что собираем" />
        </div>
        {!editing && (
          <div>
            <label style={LBL}>Тип сбора</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['recurring', 'Ежемесячный'], ['oneoff', 'Разовый']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setKind(k)} style={{ flex: 1, padding: '12px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: kind === k ? '1.5px solid #8B5CF6' : '1.5px solid rgba(255,255,255,0.1)', background: kind === k ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)', color: kind === k ? '#a78bfa' : 'var(--on-surface-variant)' }}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <div>
          <label style={LBL}>Сумма взноса, ₽</label>
          <input style={INP} type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
          <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '6px 2px 0' }}>Единая для всех. У отдельного участника сумму можно переопределить в сборе.</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 14 }}>Обязательный для резидентов</span>
          <Toggle value={mandatory} onChange={setMandatory} />
        </label>
        <Button variant="primary" fullWidth loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>
          {editing ? 'Сохранить' : 'Создать сбор'}
        </Button>
      </div>
    </Sheet>
  )
}

/* ─── Детализация сбора за период ─────────────────────────────────────────── */
function CollectionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [periodKey, setPeriodKey] = useState<string>(mskCurKey())
  const [payTarget, setPayTarget] = useState<any | null>(null)
  const [memberTarget, setMemberTarget] = useState<any | null>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['collection', id, periodKey],
    queryFn: () => api.get<any>(`/collections/${id}?period=${periodKey}`),
  })
  const coll = data?.collection
  const period = data?.period
  const totals = data?.totals
  const roster: any[] = data?.roster ?? []
  const isRecurring = coll?.kind === 'recurring'
  const curKey = mskCurKey()

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['collection', id] }); qc.invalidateQueries({ queryKey: ['collections'] }) }

  const archive = useMutation({
    mutationFn: () => api.delete(`/collections/${id}`),
    onSuccess: () => { setConfirmArchive(false); qc.invalidateQueries({ queryKey: ['collections'] }); show('Сбор архивирован'); onBack() },
    onError: () => { setConfirmArchive(false); show('Не удалось архивировать', 'error') },
  })

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={coll?.name ?? 'Сбор'} subtitle={coll ? (coll.isMandatory ? 'Обязательный взнос резидентов' : 'Добровольный сбор') : undefined}
        onBack={onBack} action={{ label: 'Изменить', icon: 'edit', onClick: () => setShowEdit(true) }} />

      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {isLoading ? <StateView state="loading" />
          : isError ? <StateView state="error" description="Не удалось загрузить сбор." action={{ label: 'Повторить', onClick: () => refetch() }} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Навигация по месяцам (для регулярного) */}
              {isRecurring && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <button onClick={() => setPeriodKey(k => shiftMonth(k, -1))} className="glass-l2" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="chevron_left" size={20} color="var(--on-surface)" /></button>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{period?.label}</span>
                  <button disabled={periodKey >= curKey} onClick={() => setPeriodKey(k => shiftMonth(k, 1))} className="glass-l2" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: periodKey >= curKey ? 'default' : 'pointer', opacity: periodKey >= curKey ? 0.35 : 1 }}><Icon name="chevron_right" size={20} color="var(--on-surface)" /></button>
                </div>
              )}

              {/* Сводка периода */}
              <div className="glass-l2" style={{ borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>Собрано за период</p>
                    <p style={{ fontSize: 26, fontWeight: 900, margin: '2px 0 0', color: '#22C55E', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(totals?.collected ?? 0)}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--on-surface)' }}>{totals?.paidCount ?? 0}<span style={{ fontSize: 13, color: 'var(--on-surface-variant)', fontWeight: 600 }}> / {totals?.eligibleCount ?? 0}</span></p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>оплатили</p>
                  </div>
                </div>
                {/* Взнос периода (редактируемый) */}
                <PeriodAmount id={id} period={period} onSaved={() => { invalidate(); show('Сумма обновлена') }} />
                {/* Разбивка по способам */}
                {totals && Object.keys(totals.byMethod ?? {}).length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Object.entries(totals.byMethod as Record<string, any>).map(([m, v]) => {
                      const meta = methodMeta(m)
                      return <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, background: `${meta.color}1f`, color: meta.color, border: `1px solid ${meta.color}33` }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color }} />{meta.label}: {formatMoney(v.total)}
                      </span>
                    })}
                  </div>
                )}
              </div>

              {/* Ростер */}
              <div className="glass-l2" style={{ borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ ...LBL, margin: 0 }}>Резиденты</span>
                  <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>{roster.length}</span>
                </div>
                {roster.length === 0 ? <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--on-surface-variant)' }}>Нет резидентов</p>
                  : roster.map(r => (
                    <div key={r.playerId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: r.excluded ? 0.55 : 1 }}>
                      <Avatar photoUrl={r.photoUrl} name={r.nickname} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nickname}</span>
                          {TIER_META[r.clientTier] && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: `${TIER_META[r.clientTier].color}22`, color: TIER_META[r.clientTier].color }}>{TIER_META[r.clientTier].label}</span>}
                        </div>
                        <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>
                          {r.excluded ? `Исключён${r.excludedForever ? ' (навсегда)' : r.excludedUntil ? ` до ${new Date(r.excludedUntil).toLocaleDateString('ru')}` : ''}`
                            : r.coveredByPrepay ? <span style={{ color: '#22C55E' }}>оплачено авансом{r.prepaidMonths > 0 ? ` · ещё ${r.prepaidMonths} мес` : ''}</span>
                            : r.paid ? <>оплатил {formatMoney(r.contribution?.amount ?? 0)} · <span style={{ color: methodMeta(r.contribution?.method).color }}>{methodMeta(r.contribution?.method).label}</span>{r.prepaid > 0 ? <span style={{ color: '#22C55E' }}> · +{formatMoney(r.prepaid)} аванс{r.prepaidMonths > 0 ? ` (${r.prepaidMonths} мес)` : ''}</span> : null}</>
                            : r.topUp > 0 ? <span style={{ color: '#F59E0B', fontWeight: 600 }}>доплатить {formatMoney(r.topUp)}{r.topUp < r.expected ? ` из ${formatMoney(r.expected)}` : ''}</span>
                            : `взнос ${formatMoney(r.expected)}`}
                        </p>
                      </div>
                      {/* Действие справа */}
                      {r.excluded ? null
                        : r.coveredByPrepay ? <span style={{ fontSize: 11, fontWeight: 800, color: '#22C55E', padding: '0 8px' }}>аванс</span>
                        : r.paid ? <button onClick={() => unmark(r)} style={ghostBtn('#F43F5E')}>Снять</button>
                        : <>
                          {/* Недобор при отметке за период: доплата складывается с ней, «Снять» — исправить ошибку */}
                          {r.contribution && <button onClick={() => unmark(r)} style={ghostBtn('#F43F5E')}>Снять</button>}
                          <button onClick={() => setPayTarget({ ...r, periodId: period.id })} style={ghostBtn(r.topUp > 0 && (r.topUp < r.expected || r.contribution) ? '#F59E0B' : '#22C55E')}>{r.topUp > 0 && (r.topUp < r.expected || r.contribution) ? 'Доплатить' : 'Оплатил'}</button>
                        </>}
                      <button onClick={() => setMemberTarget(r)} aria-label="Настройки участника" style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--on-surface-variant)' }}><Icon name="tune" size={16} /></button>
                    </div>
                  ))}
              </div>

              <button onClick={() => setConfirmArchive(true)} style={{ alignSelf: 'center', marginTop: 4, fontSize: 12, color: '#F43F5E', background: 'none', border: 'none', cursor: 'pointer', padding: 8 }}>Архивировать сбор</button>
            </div>
          )}
      </div>

      {/* Шторка оплаты */}
      {payTarget && <PaySheet collectionId={id} target={payTarget} onClose={() => setPayTarget(null)} onPaid={() => { setPayTarget(null); invalidate(); show('Взнос отмечен') }} />}
      {/* Шторка участника */}
      {memberTarget && <MemberSheet collectionId={id} target={memberTarget} periodAmount={period?.amount ?? 0} onClose={() => setMemberTarget(null)} onDone={() => { setMemberTarget(null); invalidate() }} />}
      {/* Редактирование сбора */}
      <CollectionForm open={showEdit} onClose={() => setShowEdit(false)} editing={coll} onSaved={() => { setShowEdit(false); invalidate(); show('Сохранено') }} />
      <ConfirmDialog open={confirmArchive} onClose={() => setConfirmArchive(false)} onConfirm={() => archive.mutate()} loading={archive.isPending} danger title="Архивировать сбор?" message="Сбор скроется из списка. История взносов сохранится." confirmLabel="Архивировать" />
    </div>
  )

  function unmark(r: any) {
    api.delete(`/collections/${id}/contributions/${r.contribution.id}`)
      .then(() => { invalidate(); show('Отметка снята') })
      .catch(() => show('Не удалось снять отметку', 'error'))
  }
}

const ghostBtn = (color: string): React.CSSProperties => ({ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 9, border: `1px solid ${color}44`, background: `${color}14`, color, cursor: 'pointer' })

/* ─── Взнос периода (инлайн-редактирование) ──────────────────────────────── */
function PeriodAmount({ id, period, onSaved }: { id: string; period: any; onSaved: () => void }) {
  const { show } = useToast()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(String(period?.amount ?? ''))
  React.useEffect(() => { setVal(String(period?.amount ?? '')) }, [period?.amount])
  const save = useMutation({
    mutationFn: () => api.patch(`/collections/${id}/periods/${period.id}`, { amount: parseFloat(val) || 0 }),
    onSuccess: () => { setEditing(false); onSaved() },
    onError: () => show('Не удалось сохранить', 'error'),
  })
  if (!period) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--on-surface-variant)', flex: 1 }}>Взнос за период</span>
      {editing ? (
        <>
          <input autoFocus style={{ ...INP, width: 110, padding: '8px 10px' }} type="number" inputMode="numeric" value={val} onChange={e => setVal(e.target.value)} />
          <button onClick={() => save.mutate()} style={ghostBtn('#22C55E')}>OK</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface)' }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{formatMoney(period.amount)}</span>
          <Icon name="edit" size={14} color="rgba(204,195,216,0.5)" />
        </button>
      )}
    </div>
  )
}

/* ─── Шторка отметки оплаты ───────────────────────────────────────────────── */
function PaySheet({ collectionId, target, onClose, onPaid }: { collectionId: string; target: any; onClose: () => void; onPaid: () => void }) {
  const { show } = useToast()
  // По умолчанию — сумма, чтобы закрыть текущий месяц (доплата); иначе обычный взнос.
  const [amount, setAmount] = useState(String(target.topUp && target.topUp > 0 ? target.topUp : (target.expected ?? '')))
  const [method, setMethod] = useState<Method>('cash')
  const amt = parseFloat(amount) || 0
  const insufficientDeposit = method === 'deposit' && target.balance < amt
  // Доплата к отметке периода: наличные/перевод/СБП сервер складывает с ней,
  // депозит и долг — нет (снятие такой отметки вернуло бы на баланс не ту сумму).
  const existing = target.contribution as { amount: number; method: Method } | null
  const isBalance = (m: Method) => m === 'deposit' || m === 'debt'
  const mark = existing ? `«${methodMeta(existing.method).label} · ${formatMoney(existing.amount)}»` : ''
  const mergeBlocked = !!existing && (isBalance(existing.method) || isBalance(method))
  const mergeHint = !existing ? null
    : isBalance(existing.method) ? `Отметка ${mark} не складывается с доплатой — сначала снимите её`
    : isBalance(method) ? `Депозит и долг не складываются с отметкой ${mark} — выберите наличные, перевод или СБП`
    : `Добавится к отметке ${mark}`

  const pay = useMutation({
    mutationFn: () => api.post(`/collections/${collectionId}/pay`, { periodId: target.periodId, playerId: target.playerId, amount: amt, method }),
    onSuccess: onPaid,
    onError: (e: any) => show(e?.message || 'Не удалось отметить взнос', 'error'),
  })

  return (
    <Sheet open onClose={onClose} title="Отметить оплату">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Avatar photoUrl={target.photoUrl} name={target.nickname} size={44} />
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{target.nickname}</p>
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>Баланс: {formatMoney(target.balance)}</p>
          </div>
        </div>
        <div>
          <label style={LBL}>Сумма взноса, ₽</label>
          <input style={INP} type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div>
          <label style={LBL}>Способ оплаты</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {METHODS.map(m => {
              const active = method === m.key
              return (
                <button key={m.key} onClick={() => setMethod(m.key)} style={{ padding: '12px 6px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: active ? `1.5px solid ${m.color}` : '1.5px solid rgba(255,255,255,0.1)', background: active ? `${m.color}22` : 'rgba(255,255,255,0.04)', color: active ? m.color : 'var(--on-surface-variant)' }}>{m.label}</button>
              )
            })}
          </div>
          {mergeHint ? <p style={{ fontSize: 11, color: mergeBlocked ? '#F43F5E' : 'var(--on-surface-variant)', margin: '8px 2px 0' }}>{mergeHint}</p> : <>
            {method === 'deposit' && <p style={{ fontSize: 11, color: insufficientDeposit ? '#F43F5E' : 'var(--on-surface-variant)', margin: '8px 2px 0' }}>{insufficientDeposit ? 'Недостаточно депозита — выберите «Долг»' : 'Спишется с депозита клиента (попадёт в его транзакции)'}</p>}
            {method === 'debt' && <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '8px 2px 0' }}>Запишется в долг клиента (попадёт в его транзакции)</p>}
          </>}
        </div>
        <Button variant="primary" fullWidth loading={pay.isPending} disabled={amt <= 0 || insufficientDeposit || mergeBlocked} onClick={() => pay.mutate()}>Отметить · {formatMoney(amt)}</Button>
      </div>
    </Sheet>
  )
}

/* ─── Шторка участника (исключение / своя сумма) ─────────────────────────── */
function MemberSheet({ collectionId, target, periodAmount, onClose, onDone }: { collectionId: string; target: any; periodAmount: number; onClose: () => void; onDone: () => void }) {
  const { show } = useToast()
  const [amount, setAmount] = useState(target.amountOverride != null ? String(target.amountOverride) : '')

  const call = (p: Promise<any>, ok: string) => p.then(() => { show(ok); onDone() }).catch(() => show('Не удалось выполнить', 'error'))
  const exclude = (duration: '1m' | '3m' | 'forever') => call(api.post(`/collections/${collectionId}/exclude`, { playerId: target.playerId, duration }), 'Исключён из сбора')
  const include = () => call(api.post(`/collections/${collectionId}/include`, { playerId: target.playerId }), 'Возвращён в сбор')
  const saveAmount = (val: number | null) => call(api.post(`/collections/${collectionId}/member-amount`, { playerId: target.playerId, amount: val }), 'Сумма обновлена')

  return (
    <Sheet open onClose={onClose} title={target.nickname}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Персональная сумма */}
        <div>
          <label style={LBL}>Персональная сумма взноса, ₽</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1 }} type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`по умолчанию ${formatMoney(periodAmount)}`} />
            <Button variant="secondary" onClick={() => saveAmount(amount === '' ? null : (parseFloat(amount) || 0))}>OK</Button>
          </div>
          {target.amountOverride != null && <button onClick={() => { setAmount(''); saveAmount(null) }} style={{ marginTop: 6, fontSize: 11, color: 'var(--on-surface-variant)', background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>Сбросить до общей суммы</button>}
        </div>

        {/* Исключение */}
        <div>
          <label style={LBL}>Участие в сборе</label>
          {target.excluded ? (
            <Button variant="primary" fullWidth icon="check" onClick={include}>Вернуть в сбор</Button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>Исключить из этого сбора:</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['1m', 'На месяц'], ['3m', 'На 3 месяца'], ['forever', 'Навсегда']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => exclude(k)} style={{ flex: 1, padding: '11px 6px', borderRadius: 11, cursor: 'pointer', fontSize: 12, fontWeight: 700, border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.1)', color: '#F43F5E' }}>{l}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
