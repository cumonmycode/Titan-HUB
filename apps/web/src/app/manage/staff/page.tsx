'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { PageHeader, Sheet, Toggle, LBL, INP } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/store/auth.store'
import { Icon } from '@/components/Icon'
import { MyProfile, PinKeypad } from './MyProfile'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'

interface StaffMember {
  id: string
  nickname: string
  role: 'owner' | 'staff'
  phone?: string
  permissions?: Record<string, boolean>
  tgId?: string | null
  tgUsername?: string | null
  photoUrl?: string | null
}

interface PasskeyRecord {
  id: string
  deviceType: string | null
  backedUp: boolean
  createdAt: string
}


const PERMISSION_LABELS = [
  { key: 'menu',      label: 'Меню',                  icon: 'restaurant_menu' },
  { key: 'inventory', label: 'Инвентарь',             icon: 'inventory_2' },
  { key: 'supplies',  label: 'Снабжение',             icon: 'local_shipping' },
  { key: 'clients',   label: 'Клиенты',               icon: 'group' },
  { key: 'discounts', label: 'Скидки (лояльность)',   icon: 'discount' },
  { key: 'bonus',     label: 'Бонусы (лояльность)',   icon: 'loyalty' },
  { key: 'expenses',  label: 'Расходы (аналитика)',   icon: 'payments' },
  { key: 'debtors',   label: 'Депозиты и долги',      icon: 'account_balance_wallet' },
  { key: 'staff',     label: 'Персонал',              icon: 'badge' },
  { key: 'salary',    label: 'Зарплата',              icon: 'savings' },
  { key: 'about',     label: 'О заведении',           icon: 'info' },
]

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner: { label: 'Владелец', color: '#F59E0B' },
  staff: { label: 'Персонал', color: '#8B5CF6' },
}

const AVATAR_COLORS = ['#8B5CF6', '#4cd7f6', '#10B981', '#F59E0B', '#F43F5E', '#3B82F6']
function getAvatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// ─── Mini helpers ──────────────────────────────────────────────────────────

function PermissionRow({ label, icon, value, onChange }: { label: string; icon: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <Icon name={icon} size={16} color="var(--on-surface-variant)" style={{ width: 18 }} />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--on-surface)', fontWeight: 500 }}>{label}</span>
      <Toggle size="sm" value={value} onChange={onChange} ariaLabel={label} />
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────

export default function StaffPage() {
  const router = useRouter()
  const role = useAuthStore(s => s.user?.role)
  const myId = useAuthStore(s => s.user?.id)

  // staff видит только свой профиль — без списка.
  if (role !== 'owner') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Мой профиль" onBack={() => router.push('/manage')} />
        <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%' }}>
          <MyProfile />
        </div>
      </div>
    )
  }

  return <OwnerView myId={myId} />
}

// ─── Owner view (свою карточку сверху + управление остальными) ───────────────

function OwnerView({ myId }: { myId?: string }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()

  // Sheets
  const [showProfile, setShowProfile] = useState(false)
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null)
  const [showPin, setShowPin] = useState(false)
  const [pinTarget, setPinTarget] = useState<StaffMember | null>(null)

  // Create / Edit form
  const [formNickname, setFormNickname] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formRole, setFormRole] = useState<'staff' | 'owner'>('staff')
  const [formPassword, setFormPassword] = useState('')
  const [formPinStep, setFormPinStep] = useState(false)
  const [formPin, setFormPin] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // PIN reset
  const [pinValue, setPinValue] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter')
  const [pinError, setPinError] = useState(false)
  const [pinSuccess, setPinSuccess] = useState(false)

  // Permissions
  const [perms, setPerms] = useState<Record<string, boolean>>(DEFAULT_PERMISSIONS)
  const [permsSaved, setPermsSaved] = useState(false)

  const { data, isLoading } = useQuery<{ staff: StaffMember[] }>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
  })
  // Свою карточку показываем закреплённой сверху — из списка её исключаем.
  const allStaff = data?.staff ?? []
  const others = allStaff.filter(s => s.id !== myId)
  const self = allStaff.find(s => s.id === myId)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff'] })

  // Passkeys for selected staff member
  const { data: passkeyData, refetch: refetchPasskeys } = useQuery<{ passkeys: PasskeyRecord[] }>({
    queryKey: ['staff-passkeys', selected?.id],
    queryFn: () => api.get(`/staff/${selected!.id}/passkeys`),
    enabled: !!selected,
  })
  const staffPasskeys = passkeyData?.passkeys ?? []

  const deletePasskeyMutation = useMutation({
    mutationFn: ({ staffId, passkeyId }: { staffId: string; passkeyId: string }) =>
      api.delete(`/staff/${staffId}/passkeys/${passkeyId}`),
    onSuccess: () => refetchPasskeys(),
  })

  const createMutation = useMutation({
    mutationFn: (body: object) => api.post('/staff', body),
    onSuccess: () => { invalidate(); closeForm() },
    onError: (err: any) => setFormError(err?.message || 'Ошибка сохранения. Проверьте данные.'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/staff/${id}`, body),
    onSuccess: () => { invalidate(); closeForm() },
    onError: (err: any) => setFormError(err?.message || 'Ошибка сохранения. Проверьте данные.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/staff/${id}`),
    onSuccess: () => { invalidate(); setSelected(null) },
    onError: () => show('Не удалось удалить сотрудника', 'error'),
  })

  const resetPinMutation = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) =>
      api.post(`/staff/${id}/reset-pin`, { pin }),
    onSuccess: () => {
      setPinSuccess(true)
      setTimeout(() => { setShowPin(false); setPinSuccess(false) }, 1500)
    },
    onError: () => show('Не удалось сменить PIN', 'error'),
  })

  const updatePermsMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: Record<string, boolean> }) =>
      api.patch(`/staff/${id}`, { permissions }),
    onSuccess: () => {
      invalidate()
      setPermsSaved(true)
      setTimeout(() => setPermsSaved(false), 1800)
    },
    onError: () => show('Не удалось сохранить права', 'error'),
  })

  // Привязка Telegram к админ-боту (диплинк + QR).
  const [tgLink, setTgLink] = useState<{ deepLink: string; qrDataUrl: string } | null>(null)
  const tgLinkMutation = useMutation({
    mutationFn: (id: string) => api.post<{ deepLink: string; qrDataUrl: string }>(`/staff/${id}/telegram-link`),
    onSuccess: (r) => setTgLink({ deepLink: r.deepLink, qrDataUrl: r.qrDataUrl }),
    onError: () => show('Не удалось создать ссылку привязки', 'error'),
  })

  // ── Form helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null)
    setFormNickname('')
    setFormPhone('')
    setFormRole('staff')
    setFormPassword('')
    setFormPin('')
    setFormPinStep(false)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(s: StaffMember) {
    setEditTarget(s)
    setFormNickname(s.nickname)
    setFormPhone(s.phone ?? '')
    setFormRole(s.role)
    setFormPassword('')
    setFormPin('')
    setFormPinStep(false)
    setFormError(null)
    setShowForm(true)
    setSelected(null)
  }

  function closeForm() {
    setShowForm(false)
    setEditTarget(null)
    setFormPinStep(false)
    setFormError(null)
  }

  function openPinReset(s: StaffMember) {
    setPinTarget(s)
    setPinValue('')
    setPinConfirm('')
    setPinStep('enter')
    setPinError(false)
    setPinSuccess(false)
    setShowPin(true)
    setSelected(null)
  }

  function openDetail(s: StaffMember) {
    setSelected(s)
    setPerms({ ...DEFAULT_PERMISSIONS, ...(s.permissions ?? {}) })
    setPermsSaved(false)
  }

  const mainFieldsOk = formNickname.trim().length >= 2 && (!editTarget ? formPassword.length >= 4 : true)

  function handleNextToPin() {
    if (!mainFieldsOk) return
    setFormError(null)
    setFormPinStep(true)
  }

  function submitForm() {
    if (editTarget) {
      const body: Record<string, unknown> = { nickname: formNickname, role: formRole }
      if (formPhone) body.phone = formPhone
      if (formPassword) body.password = formPassword
      if (formPin.length === 4) body.pin = formPin
      updateMutation.mutate({ id: editTarget.id, body })
    } else {
      const body: Record<string, unknown> = {
        nickname: formNickname,
        role: formRole,
        password: formPassword,
      }
      if (formPhone) body.phone = formPhone
      if (formPin.length === 4) body.pin = formPin
      createMutation.mutate(body)
    }
  }

  // ── PIN reset helpers ────────────────────────────────────────────────────

  function handlePinInput(v: string) {
    if (pinStep === 'enter') {
      setPinValue(v)
      if (v.length === 4) {
        setTimeout(() => { setPinStep('confirm') }, 200)
      }
    } else {
      setPinConfirm(v)
      if (v.length === 4) {
        setTimeout(() => {
          if (v === pinValue) {
            resetPinMutation.mutate({ id: pinTarget!.id, pin: pinValue })
          } else {
            setPinError(true)
            setTimeout(() => {
              setPinValue('')
              setPinConfirm('')
              setPinStep('enter')
              setPinError(false)
            }, 800)
          }
        }, 200)
      }
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  // Имя владельца для собственной карточки.
  const selfNickname = self?.nickname ?? useAuthStore.getState().user?.nickname ?? 'Вы'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PageHeader
        title="Пользователи"
        subtitle={`${others.length + 1} ${others.length + 1 === 1 ? 'пользователь' : others.length + 1 <= 4 ? 'пользователя' : 'пользователей'}`}
        action={{ label: 'Добавить', icon: 'person_add', onClick: openCreate }}
      />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%' }}>

        {/* ─── Своя карточка (закреплена сверху) ─────────────────────────── */}
        <div
          className="glass-l2"
          onClick={() => setShowProfile(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, cursor: 'pointer', border: '1px solid rgba(139,92,246,0.3)', marginBottom: 18 }}
        >
          {self?.photoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={self.photoUrl} alt="" width={48} height={48} style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
            : <div style={{
                width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
                background: getAvatarColor(selfNickname),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 19, color: '#fff',
              }}>
                {selfNickname[0]?.toUpperCase()}
              </div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--on-surface)' }}>{selfNickname}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: 'rgba(139,92,246,0.2)', color: '#A78BFA' }}>вы</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Мой профиль · {ROLE_LABELS.owner.label}</span>
          </div>
          <Icon name="chevron_right" size={20} color="var(--on-surface-variant)" />
        </div>

        {/* ─── Список остальных пользователей ────────────────────────────── */}
        <p style={{ ...LBL, marginBottom: 10, paddingLeft: 4 }}>Сотрудники</p>
        {isLoading && !data ? (
          <StateView state="loading" />
        ) : others.length === 0 ? (
          <StateView state="empty" icon="group" title="Других пользователей нет" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {others.map(s => {
              const roleInfo = ROLE_LABELS[s.role] ?? ROLE_LABELS.staff
              return (
                <div
                  key={s.id}
                  className="glass-l2"
                  onClick={() => openDetail(s)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 16, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  {s.photoUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.photoUrl} alt="" width={44} height={44} style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
                    : <div style={{
                        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                        background: getAvatarColor(s.nickname),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 18, color: '#fff',
                      }}>
                        {s.nickname[0]?.toUpperCase()}
                      </div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--on-surface)', marginBottom: 3 }}>{s.nickname}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8,
                        background: `${roleInfo.color}22`, color: roleInfo.color,
                      }}>{roleInfo.label}</span>
                      {s.phone && <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{s.phone}</span>}
                    </div>
                  </div>
                  <Icon name="chevron_right" size={20} color="var(--on-surface-variant)" />
                </div>
              )
            })}
          </div>
        )}

        {/* ─── Свой профиль (Sheet) ──────────────────────────────────────── */}
        <Sheet open={showProfile} onClose={() => setShowProfile(false)} title="Мой профиль">
          {showProfile && <MyProfile />}
        </Sheet>

        {/* ─── Detail / управление пользователем (Sheet) ─────────────────── */}
        <Sheet open={!!selected} onClose={() => { setSelected(null); setTgLink(null) }} title={selected?.nickname}>
          {selected && (
            <div>
              {/* Avatar + role */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 24 }}>
                {selected.photoUrl
                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={selected.photoUrl} alt="" width={72} height={72} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                  : <div style={{
                      width: 72, height: 72, borderRadius: '50%',
                      background: getAvatarColor(selected.nickname),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 30, color: '#fff',
                    }}>
                      {selected.nickname[0]?.toUpperCase()}
                    </div>}
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 999,
                  background: `${(ROLE_LABELS[selected.role]?.color ?? '#8B5CF6')}22`,
                  color: ROLE_LABELS[selected.role]?.color ?? '#8B5CF6',
                }}>
                  {ROLE_LABELS[selected.role]?.label}
                </span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button
                  onClick={() => openEdit(selected)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '12px', borderRadius: 14,
                    border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.1)',
                    color: '#A78BFA', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  <Icon name="edit" size={18} />
                  Изменить
                </button>
                <button
                  onClick={() => openPinReset(selected)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '12px', borderRadius: 14,
                    border: '1px solid rgba(76,215,246,0.4)', background: 'rgba(76,215,246,0.1)',
                    color: '#4cd7f6', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  <Icon name="pin" size={18} />
                  Задать PIN
                </button>
              </div>

              {/* Telegram (админ-бот) */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ ...LBL, marginBottom: 8 }}>Telegram (админ-бот)</p>
                {selected.tgId ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: 'rgba(34,158,217,0.08)', border: '1px solid rgba(34,158,217,0.2)' }}>
                    <Icon name="send" size={18} color="#229ED9" />
                    <span style={{ fontSize: 13, color: 'var(--on-surface)' }}>Привязан{selected.tgUsername ? ` · @${selected.tgUsername}` : ''}</span>
                  </div>
                ) : tgLink ? (
                  <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(34,158,217,0.06)', border: '1px solid rgba(34,158,217,0.2)', textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={tgLink.qrDataUrl} alt="QR для привязки Telegram" width={180} height={180} style={{ borderRadius: 12, background: '#fff', padding: 6 }} />
                    <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '10px 0' }}>Откройте ссылку на телефоне сотрудника или отсканируйте QR. Ссылка действует 15 минут.</p>
                    <a href={tgLink.deepLink} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, background: 'linear-gradient(135deg,#229ED9,#4cd7f6)', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
                      <Icon name="send" size={16} />Открыть в Telegram
                    </a>
                  </div>
                ) : (
                  <button onClick={() => tgLinkMutation.mutate(selected.id)} disabled={tgLinkMutation.isPending}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 14, border: '1px solid rgba(34,158,217,0.4)', background: 'rgba(34,158,217,0.1)', color: '#229ED9', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    <Icon name="send" size={18} />{tgLinkMutation.isPending ? 'Создаём ссылку…' : 'Привязать Telegram'}
                  </button>
                )}
              </div>

              {/* Passkeys section */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ ...LBL, marginBottom: 8 }}>Passkey / биометрия</p>
                {staffPasskeys.length === 0 ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                    borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <Icon name="fingerprint" size={18} color="var(--on-surface-variant)" />
                    <span style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>Passkey не настроен</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {staffPasskeys.map(pk => (
                      <div key={pk.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                        borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <Icon name="fingerprint" size={18} color="#A78BFA" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>
                            {pk.deviceType === 'multiDevice' ? 'Синхронизированный ключ' : pk.deviceType === 'singleDevice' ? 'Ключ устройства' : 'Passkey'}
                            {pk.backedUp && <span style={{ fontSize: 10, marginLeft: 6, color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '1px 6px', borderRadius: 4 }}>Cloud</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>
                            {new Date(pk.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                        <button
                          onClick={() => deletePasskeyMutation.mutate({ staffId: selected.id, passkeyId: pk.id })}
                          disabled={deletePasskeyMutation.isPending}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 8,
                            border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)',
                            color: '#EF4444', cursor: 'pointer',
                          }}
                        >
                          <Icon name="delete" size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Permissions (staff only) */}
              {selected.role === 'staff' && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ ...LBL, marginBottom: 6 }}>Права доступа</p>
                  <div style={{ marginBottom: 12 }}>
                    {PERMISSION_LABELS.map(({ key, label, icon }) => (
                      <PermissionRow
                        key={key}
                        label={label}
                        icon={icon}
                        value={perms[key] ?? DEFAULT_PERMISSIONS[key] ?? true}
                        onChange={v => setPerms(p => ({ ...p, [key]: v }))}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => updatePermsMutation.mutate({ id: selected.id, permissions: perms })}
                    disabled={updatePermsMutation.isPending}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: permsSaved ? 'rgba(16,185,129,0.15)' : 'linear-gradient(135deg,#8B5CF6,#4cd7f6)',
                      color: permsSaved ? '#10B981' : '#fff', fontWeight: 700, fontSize: 14, transition: 'background 0.3s',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {permsSaved
                      ? <><Icon name="check_circle" size={16} />Сохранено</>
                      : updatePermsMutation.isPending ? 'Сохранение...' : 'Сохранить права'}
                  </button>
                </div>
              )}

              {/* Delete */}
              <button
                onClick={() => deleteMutation.mutate(selected.id)}
                disabled={deleteMutation.isPending}
                style={{
                  width: '100%', padding: '13px', borderRadius: 14,
                  border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)',
                  color: '#EF4444', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                }}
              >
                {deleteMutation.isPending ? 'Удаление...' : 'Удалить сотрудника'}
              </button>
            </div>
          )}
        </Sheet>

        {/* ─── Create / Edit Sheet ────────────────────────────────────────── */}
        <Sheet
          open={showForm}
          onClose={closeForm}
          title={formPinStep ? 'PIN сотрудника' : editTarget ? 'Редактировать' : 'Новый сотрудник'}
        >
          {!formPinStep ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={LBL}>Никнейм *</label>
                <input style={INP} placeholder="Например: Алекс" value={formNickname} onChange={e => setFormNickname(e.target.value)} />
              </div>
              <div>
                <label style={LBL}>Телефон</label>
                <input style={INP} placeholder="+7 999 000 00 00" value={formPhone} onChange={e => setFormPhone(e.target.value)} />
              </div>
              <div>
                <label style={LBL}>Роль</label>
                <select style={{ ...INP, background: 'rgba(29,26,36,0.8)', cursor: 'pointer' }} value={formRole} onChange={e => setFormRole(e.target.value as 'staff' | 'owner')}>
                  <option value="staff">Персонал</option>
                  <option value="owner">Владелец</option>
                </select>
              </div>
              <div>
                <label style={LBL}>{editTarget ? 'Новый пароль (необязательно)' : 'Пароль для входа *'}</label>
                <input
                  style={INP} type="password"
                  placeholder={editTarget ? 'Оставьте пустым, чтобы не менять' : 'Минимум 4 символа'}
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
                <Icon name="pin" size={18} color="#A78BFA" />
                <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>
                  На следующем шаге можно сразу задать 4-значный PIN для быстрого входа
                </p>
              </div>

              <button
                onClick={handleNextToPin}
                disabled={!mainFieldsOk || isPending}
                style={{
                  padding: '14px', borderRadius: 14, border: 'none', cursor: mainFieldsOk ? 'pointer' : 'not-allowed',
                  background: mainFieldsOk ? 'linear-gradient(135deg,#8B5CF6,#4cd7f6)' : 'rgba(255,255,255,0.08)',
                  color: mainFieldsOk ? '#fff' : 'var(--on-surface-variant)', fontWeight: 700, fontSize: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                Далее — задать PIN
                <Icon name="arrow_forward" size={18} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: 0, textAlign: 'center' }}>
                Введите 4-значный PIN для сотрудника <strong style={{ color: 'var(--on-surface)' }}>{formNickname}</strong>.
                Это необязательно — без PIN сотрудник войдёт по паролю и установит PIN сам.
              </p>

              <PinKeypad
                value={formPin}
                onChange={setFormPin}
                label="4-значный PIN (необязательно)"
              />

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setFormPinStep(false)}
                  style={{
                    flex: 1, padding: '13px', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
                    color: 'var(--on-surface-variant)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Назад
                </button>
                <button
                  onClick={submitForm}
                  disabled={isPending || (formPin.length > 0 && formPin.length < 4)}
                  style={{
                    flex: 2, padding: '13px', borderRadius: 14, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg,#8B5CF6,#4cd7f6)',
                    color: '#fff', fontWeight: 700, fontSize: 15,
                    opacity: (isPending || (formPin.length > 0 && formPin.length < 4)) ? 0.6 : 1,
                  }}
                >
                  {isPending ? 'Сохранение...' : editTarget ? 'Сохранить' : 'Создать'}
                </button>
              </div>

              {formError && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: 13 }}>
                  {formError}
                </div>
              )}
            </div>
          )}
        </Sheet>

        {/* ─── PIN Reset Sheet ────────────────────────────────────────────── */}
        <Sheet
          open={showPin}
          onClose={() => setShowPin(false)}
          title={pinStep === 'enter' ? `PIN — ${pinTarget?.nickname}` : 'Подтвердите PIN'}
        >
          {pinSuccess ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '20px 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', border: '2px solid #10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check_circle" size={38} color="#10B981" />
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: '#10B981', margin: 0 }}>PIN установлен!</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: 0, textAlign: 'center' }}>
                {pinStep === 'enter'
                  ? 'Введите новый 4-значный PIN'
                  : 'Введите PIN ещё раз для подтверждения'}
              </p>

              <PinKeypad
                value={pinStep === 'enter' ? pinValue : pinConfirm}
                onChange={handlePinInput}
                error={pinError}
              />

              {pinError && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: 13, textAlign: 'center' }}>
                  PIN-коды не совпадают — попробуйте снова
                </div>
              )}

              {resetPinMutation.isError && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', fontSize: 13 }}>
                  Ошибка сохранения PIN
                </div>
              )}
            </div>
          )}
        </Sheet>
      </div>
    </div>
  )
}
