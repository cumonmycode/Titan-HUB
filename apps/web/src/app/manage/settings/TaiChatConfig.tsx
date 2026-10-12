'use client'
/**
 * Блок «Tai в чатах» (вкладка «Поведение»).
 *
 * У каждой группы свои настройки: режим (игровой чат клуба или рабочий чат
 * персонала), стиль общения, жёсткость и мат — мат включается для каждого чата
 * отдельно, в любом режиме. В игровом чате Tai шутит, когда к нему обращаются
 * («тай …» или ответом на его сообщение); в рабочем — отвечает сотрудникам по работе.
 * Рамки (без хейта/угроз/запрещёнки) — всегда. Нужен бот Tai + ИИ-ключ.
 */
import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'

type Harshness = 'soft' | 'medium' | 'savage'
type Mode = 'game' | 'work'
interface Preset { key: string; label: string; desc: string }
interface ChatCfg { id: number | string; title: string; type: string; mode: Mode; enabled: boolean; profanity: boolean; harshness: Harshness; preset: string }
interface Cfg { enabled: boolean; presets: Preset[]; chats: ChatCfg[]; botReady: boolean; aiReady: boolean }

const HARSH: { key: Harshness; label: string }[] = [
  { key: 'soft', label: 'Мягко' },
  { key: 'medium', label: 'Средне' },
  { key: 'savage', label: 'Жёстко' },
]
const MODES: { key: Mode; label: string }[] = [
  { key: 'game', label: 'Игровой' },
  { key: 'work', label: 'Рабочий' },
]
const toggleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0' }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
const labelStyle: React.CSSProperties = { fontSize: 12.5, color: 'var(--on-surface-variant)' }

function Segmented<T extends string>({ items, value, disabled, onChange }: { items: { key: T; label: string }[]; value: T; disabled: boolean; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 9, padding: 3 }}>
      {items.map((it) => {
        const active = value === it.key
        return (
          <button key={it.key} type="button" disabled={disabled} onClick={() => onChange(it.key)}
            style={{
              padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: active ? '#8B5CF6' : 'transparent',
              color: active ? '#fff' : 'var(--on-surface-variant)',
            }}>{it.label}</button>
        )
      })}
    </div>
  )
}

function ChatCard({ chat, presets, busy, onPatch }: { chat: ChatCfg; presets: Preset[]; busy: boolean; onPatch: (patch: Partial<ChatCfg>) => void }) {
  const work = chat.mode === 'work'
  return (
    <div style={{ borderRadius: 14, padding: '11px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={rowStyle}>
        <span style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title || `Чат ${chat.id}`}</span>
        <Segmented items={MODES} value={chat.mode} disabled={busy} onChange={(mode) => onPatch({ mode })} />
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.45 }}>
        {work
          ? 'Рабочий чат персонала: Tai отвечает сотрудникам про смену, кассу, цифры и записи — с правами того, кто спросил.'
          : 'Игровой чат клуба: опросы, команды @all / @tvari и шутки Tai, когда к нему обращаются.'}
      </p>
      {!work && (
        <div style={rowStyle}>
          <span style={labelStyle}>Шутить в этом чате</span>
          <input type="checkbox" checked={chat.enabled} disabled={busy} onChange={(e) => onPatch({ enabled: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#8B5CF6', flexShrink: 0 }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={labelStyle}>Стиль общения</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => {
            const active = chat.preset === p.key
            return (
              <button key={p.key} type="button" title={p.desc} disabled={busy} onClick={() => onPatch({ preset: p.key })}
                style={{
                  padding: '6px 11px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  border: active ? '1.5px solid #8B5CF6' : '1px solid rgba(255,255,255,0.1)',
                  background: active ? 'rgba(139,92,246,0.14)' : 'rgba(255,255,255,0.03)',
                  color: active ? '#c4b5fd' : 'var(--on-surface)',
                }}>{p.label}</button>
            )
          })}
        </div>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Жёсткость</span>
        <Segmented items={HARSH} value={chat.harshness} disabled={busy} onChange={(harshness) => onPatch({ harshness })} />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Мат</span>
        <input type="checkbox" checked={chat.profanity} disabled={busy} onChange={(e) => onPatch({ profanity: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#8B5CF6', flexShrink: 0 }} />
      </div>
    </div>
  )
}

export function TaiChatConfig() {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data } = useQuery<Cfg>({ queryKey: ['tai-chat-config'], queryFn: () => api.get('/system/tai-chat-config') })
  // Локальное состояние пер-групповых настроек (чтобы менять без дёрганья сети на каждый клик).
  const [chats, setChats] = React.useState<ChatCfg[]>([])
  React.useEffect(() => { if (data?.chats) setChats(data.chats) }, [data?.chats])

  const save = useMutation({
    mutationFn: (patch: Partial<{ enabled: boolean; chats: ChatCfg[] }>) => api.put('/system/tai-chat-config', patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tai-chat-config'] }); show('Сохранено', 'success') },
    onError: () => show('Не удалось сохранить', 'error'),
  })

  if (!data) return null
  const blocked = !data.botReady || !data.aiReady

  const patchChat = (id: ChatCfg['id'], patch: Partial<ChatCfg>) => {
    const next = chats.map((ch) => (ch.id === id ? { ...ch, ...patch } : ch))
    setChats(next)
    save.mutate({ chats: next })
  }

  return (
    <div className="glass-l2" style={{ borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="auto_awesome" size={18} color="#a78bfa" />
        <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Tai в чатах</p>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '0 0 4px', lineHeight: 1.5 }}>
        Для каждой группы — свой режим, стиль общения и мат. Обращайтесь к Tai «тай …» или ответом на его сообщение. Добавите Tai в чат сотрудников — он сам станет рабочим.
      </p>

      {blocked && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.28)' }}>
          <Icon name="info" size={16} color="#F59E0B" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
            {!data.botReady && 'Подключите «Tai — бот клуба» во вкладке «Интеграции». '}
            {!data.aiReady && 'Нужен ключ Tai (модуль «Tai — ИИ-ассистент»).'}
          </span>
        </div>
      )}

      {!blocked && (
        <>
          <label style={toggleRow}>
            <span style={{ fontSize: 13.5 }}>Шутки в игровых чатах <span style={{ color: 'var(--on-surface-variant)', fontSize: 12 }}>— главный выключатель</span></span>
            <input type="checkbox" checked={data.enabled} disabled={save.isPending} onChange={(e) => save.mutate({ enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#8B5CF6' }} />
          </label>

          <p style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 6px' }}>Группы</p>
          {chats.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
              Группы появятся здесь, как только Tai увидит сообщения в чате. Добавьте бота в группу и напишите что-нибудь.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chats.map((ch) => (
                <ChatCard key={String(ch.id)} chat={ch} presets={data.presets} busy={save.isPending} onPatch={(patch) => patchChat(ch.id, patch)} />
              ))}
            </div>
          )}

          <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '10px 0 0', lineHeight: 1.5 }}>
            Рамки соблюдаются всегда: без оскорблений по нац-ти/религии/полу/ориентации, без угроз и запрещёнки.
          </p>
        </>
      )}
    </div>
  )
}
