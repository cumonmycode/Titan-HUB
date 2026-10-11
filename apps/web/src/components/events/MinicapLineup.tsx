'use client'
/**
 * Состав миникапа в просмотре события: судья + до 10 игроков, отметка «Оплатил»,
 * сумма чека участника, добавление через поиск игроков кассы (или создание нового).
 * Логика та же, что была в MinicapSheet (режим управления).
 */
import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'
import { Button, Chip, IconButton, INP } from '@/components/manage/DesignSystem'
import { Card } from '@/components/manage/goods/parts'
import { MINICAP_MAX_PLAYERS, MUTED, num, rub } from './lib'

export interface Participant {
  id: string
  profileId: string
  nickname: string | null
  role: string
  prepaid: boolean
  checkId: string | null
  checkTotal: string | null
}

interface PlayerHit { id: string; nickname: string }

const SEARCH_DEBOUNCE_MS = 300
const TIERS: [string, string][] = [['guest', 'Гость'], ['resident', 'Резидент'], ['student', 'Студент']]

export function useParticipants(eventId: string | null, enabled: boolean) {
  const q = useQuery({
    queryKey: ['events', eventId, 'participants'],
    queryFn: () => api.get<{ participants: Participant[] }>(`/events/${eventId}/participants`),
    enabled: enabled && !!eventId,
  })
  const participants = q.data?.participants ?? []
  return {
    players: participants.filter(p => p.role === 'player'),
    judge: participants.find(p => p.role === 'judge') ?? null,
    isLoading: q.isLoading,
  }
}

/** Поиск игрока (эндпоинт кассы) с дебаунсом; «Создать игрока», если не нашёлся. */
function PlayerSearch({ onPick, exclude, placeholder }: { onPick: (p: PlayerHit) => void; exclude: Set<string>; placeholder: string }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlayerHit[]>([])
  const [creating, setCreating] = useState(false)
  const [newNick, setNewNick] = useState('')
  const [newTier, setNewTier] = useState('guest')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const term = q.trim()
    if (!term) { setResults([]); return }
    let stale = false
    timer.current = setTimeout(async () => {
      try {
        const r = await api.get<{ players: PlayerHit[] }>(`/pos/players/search?q=${encodeURIComponent(term)}`)
        if (!stale) setResults(r.players ?? [])
      } catch { if (!stale) setResults([]) }
    }, SEARCH_DEBOUNCE_MS)
    return () => { stale = true; if (timer.current) clearTimeout(timer.current) }
  }, [q])

  const reset = () => { setCreating(false); setNewNick(''); setQ(''); setResults([]) }
  const createClient = useMutation({
    mutationFn: () => api.post<{ client: PlayerHit }>('/clients', { nickname: newNick.trim(), clientTier: newTier }),
    onSuccess: (r) => { onPick(r.client); reset(); qc.invalidateQueries({ queryKey: ['clients'] }) },
    onError: (e: Error) => show(e?.message ?? 'Не удалось создать игрока', 'error'),
  })

  const visible = results.filter(p => !exclude.has(p.id))
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={INP} />
      {q.trim() !== '' && (
        <div className="glass-l2" style={{ marginTop: 6, borderRadius: 14, overflow: 'hidden' }}>
          {visible.map(p => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(''); setResults([]) }}
              style={{ width: '100%', minHeight: 46, padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-surface)', fontSize: 14.5 }}>
              <Icon name="person" size={16} color={MUTED} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</span>
              <Icon name="add" size={16} color="var(--primary-violet)" />
            </button>
          ))}
          {!creating ? (
            <button type="button" onClick={() => { setCreating(true); setNewNick(q.trim()) }}
              style={{ width: '100%', minHeight: 46, padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--on-surface)', fontSize: 14.5, fontWeight: 600 }}>
              <Icon name="person_add" size={16} color="var(--primary-violet)" /> Создать игрока «{q.trim()}»
            </button>
          ) : (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={newNick} onChange={e => setNewNick(e.target.value)} placeholder="Никнейм" aria-label="Никнейм" style={INP} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TIERS.map(([k, l]) => <Chip key={k} size="sm" active={newTier === k} onClick={() => setNewTier(k)}>{l}</Chip>)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" size="sm" fullWidth onClick={() => setCreating(false)}>Отмена</Button>
                <Button size="sm" fullWidth loading={createClient.isPending} disabled={newNick.trim().length < 2} onClick={() => createClient.mutate()}>Создать и добавить</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface LineupProps {
  eventId: string
  players: Participant[]
  judge: Participant | null
  /** false — завершённый/отменённый миникап: состав только для чтения. */
  editable: boolean
}

export function MinicapLineup({ eventId, players, judge, editable }: LineupProps) {
  const qc = useQueryClient()
  const { show } = useToast()
  const refresh = () => qc.invalidateQueries({ queryKey: ['events', eventId, 'participants'] })
  const fail = (fallback: string) => (e: Error) => show(e?.message || fallback, 'error')

  const add = useMutation({
    mutationFn: (b: { profileId: string; role: 'player' | 'judge' }) => api.post(`/events/${eventId}/participants`, b),
    onSuccess: refresh,
    onError: fail('Не удалось добавить'),
  })
  const setPrepaid = useMutation({
    mutationFn: ({ pid, prepaid }: { pid: string; prepaid: boolean }) => api.patch(`/events/${eventId}/participants/${pid}`, { prepaid }),
    onSuccess: refresh,
    onError: fail('Не удалось отметить оплату'),
  })
  const remove = useMutation({
    mutationFn: (pid: string) => api.delete(`/events/${eventId}/participants/${pid}`),
    onSuccess: refresh,
    onError: fail('Не удалось убрать из состава'),
  })

  const exclude = new Set<string>([...players.map(p => p.profileId), ...(judge ? [judge.profileId] : [])])
  const canAddPlayer = editable && players.length < MINICAP_MAX_PLAYERS

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="Судья">
        {judge ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px', minHeight: 52 }}>
            <Icon name="gavel" size={18} color={MUTED} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{judge.nickname ?? 'Без имени'}</span>
            {editable && <IconButton icon="close" variant="ghost" ariaLabel="Убрать судью" onClick={() => remove.mutate(judge.id)} disabled={remove.isPending} />}
          </div>
        ) : editable ? (
          <div style={{ padding: 12 }}>
            <PlayerSearch onPick={(p) => add.mutate({ profileId: p.id, role: 'judge' })} exclude={exclude} placeholder="Найти судью…" />
          </div>
        ) : (
          <p style={{ margin: 0, padding: '14px 16px', fontSize: 14, color: MUTED }}>Судья не назначен</p>
        )}
      </Card>

      <Card title={`Игроки · ${players.length}/${MINICAP_MAX_PLAYERS}`}>
        {players.length === 0 && (
          <p style={{ margin: 0, padding: '14px 16px', fontSize: 14, color: MUTED }}>Состав пуст — добавьте игроков, чтобы начать миникап</p>
        )}
        {players.map((p, i) => {
          const total = num(p.checkTotal)
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 16px', minHeight: 52 }}>
              <span style={{ width: 18, fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname ?? 'Без имени'}</span>
              {total != null && <span style={{ fontSize: 12.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{rub(total)}</span>}
              {editable ? (
                <Chip size="sm" icon={p.prepaid ? 'check_circle' : 'radio_button_unchecked'} active={p.prepaid} activeColor="var(--success)"
                  onClick={() => setPrepaid.mutate({ pid: p.id, prepaid: !p.prepaid })}>Оплатил</Chip>
              ) : p.prepaid ? (
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--success)' }}>Оплатил</span>
              ) : null}
              {editable && <IconButton icon="close" variant="ghost" size={36} ariaLabel={`Убрать ${p.nickname ?? 'игрока'}`} onClick={() => remove.mutate(p.id)} disabled={remove.isPending} />}
            </div>
          )
        })}
        {canAddPlayer && (
          <div style={{ padding: 12 }}>
            <PlayerSearch onPick={(p) => add.mutate({ profileId: p.id, role: 'player' })} exclude={exclude} placeholder="Найти игрока… (или создать)" />
          </div>
        )}
      </Card>
    </div>
  )
}
