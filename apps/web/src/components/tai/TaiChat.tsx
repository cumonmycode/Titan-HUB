'use client'
/**
 * Tai — чат-ассистент (веб): та же логика, что в приложении HUB. Поток ответа со
 * статусами, интерактивные блоки и карточки действий; голос — распознавание браузера
 * (Web Speech API), где его нет — запись и распознавание на сервере; ответ озвучивается.
 * Раскладка: сообщения скроллятся внутри, поле ввода прижато к низу.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { TaiLogo } from '@/components/TaiLogo'
import { speakTai, transcribeVoice, type TaiContext, type TaiRoute } from '@/lib/tai'
import { revealTai, setTaiAudioListener, taiHref, ungateTai, useTaiStore, type TaiAudioClip, type TaiMessage, type TaiReply } from '@/store/tai.store'
import { TaiBlockView } from './TaiBlocks'

const STARTERS: Record<NonNullable<TaiContext['screen']>, { hint: string; items: { text: string; draft?: boolean }[] }> = {
  pos: { hint: 'Открою чек, добавлю позиции, расскажу, как идёт смена.', items: [{ text: 'Открой чек на ', draft: true }, { text: 'Как идёт смена?' }, { text: 'Открытые чеки' }, { text: 'Что заканчивается на складе?' }] },
  check: { hint: 'Добавлю позиции в этот чек, сделаю скидку, подскажу про гостя.', items: [{ text: 'Добавь ', draft: true }, { text: 'Скидка 10%' }, { text: 'Что этот гость обычно берёт?' }, { text: 'Что уже в чеке?' }] },
  analytics: { hint: 'Объясню цифры, сравню периоды, найду чеки.', items: [{ text: 'Сравни эту неделю с прошлой' }, { text: 'Часы пик за месяц' }, { text: 'Топ товаров за неделю' }, { text: 'Кто тратит больше всех?' }] },
  other: { hint: 'Спросите о клубе или попросите действие в кассе.', items: [{ text: 'Выручка за сегодня' }, { text: 'Как идёт смена?' }, { text: 'Что заканчивается на складе?' }, { text: 'Открой чек на ', draft: true }] },
}

/* ─────────────────────────── Голос ─────────────────────────── */

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

/**
 * Голос в браузере: слушаем, пауза ~1,3 с — фраза уходит Tai; ответ читаем вслух
 * системным голосом и снова слушаем, пока не нажали «Стоп».
 */
function useWebVoice(onUtterance: (text: string) => Promise<void>) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'recording' | 'thinking' | 'speaking'>('idle')
  const [transcript, setTranscript] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const heard = useRef('')
  const lastAt = useRef(0)
  const conversation = useRef(false)
  const queue = useRef<{ audio: HTMLAudioElement; reveal?: { replyId: string; upTo: number; blocks: number } }[]>([])
  const playing = useRef<HTMLAudioElement | null>(null)
  const replyFinished = useRef(false)

  const Ctor = typeof window !== 'undefined' ? ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition) : undefined

  const finish = useCallback(async (text: string) => {
    if (!text.trim()) { conversation.current = false; setPhase('idle'); return }
    setPhase('thinking')
    await onUtterance(text.trim())
  }, [onUtterance])

  const listen = useCallback(async () => {
    playing.current?.pause()
    playing.current = null
    queue.current = []
    replyFinished.current = false
    conversation.current = true
    heard.current = ''
    setTranscript('')
    if (Ctor) {
      const rec = new Ctor()
      rec.lang = 'ru-RU'
      rec.interimResults = true
      rec.continuous = true
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim()
        if (text !== heard.current) lastAt.current = Date.now()
        heard.current = text
        setTranscript(text)
      }
      rec.onerror = () => undefined
      rec.onend = () => { recognition.current = null; if (conversation.current) void finish(heard.current) }
      recognition.current = rec
      lastAt.current = Date.now()
      rec.start()
      setPhase('listening')
      return
    }
    // Без распознавания в браузере — записываем и распознаём на сервере.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => chunks.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        recorder.current = null
        if (!conversation.current) return
        setPhase('thinking')
        const text = await transcribeVoice(new Blob(chunks, { type: rec.mimeType })).catch(() => '')
        setTranscript(text)
        await finish(text)
      }
      recorder.current = rec
      rec.start()
      setPhase('recording')
    } catch {
      conversation.current = false
      setPhase('idle')
      alert('Нет доступа к микрофону. Разрешите его в настройках браузера.')
    }
  }, [Ctor, finish])

  // Пауза после речи — конец фразы.
  useEffect(() => {
    if (phase !== 'listening') return
    const timer = setInterval(() => {
      const quiet = Date.now() - lastAt.current
      if (heard.current ? quiet > 1300 : quiet > 7000) recognition.current?.stop()
    }, 200)
    return () => clearInterval(timer)
  }, [phase])

  const done = useCallback(() => { recognition.current?.stop(); recorder.current?.stop() }, [])
  const end = useCallback(() => {
    conversation.current = false
    recognition.current?.abort()
    recorder.current?.stop()
    playing.current?.pause()
    playing.current = null
    queue.current = []
    ungateTai()
    setPhase('idle')
  }, [])

  // Ответ озвучивает сервер нейросетевым голосом: фразы приходят звуком в потоке.
  const afterSpeech = useCallback(() => {
    if (playing.current || queue.current.length || !replyFinished.current) return
    ungateTai()
    if (conversation.current) setTimeout(() => conversation.current && void listen(), 300)
    else setPhase('idle')
  }, [listen])
  const playNextRef = useRef<() => void>(() => undefined)
  const playNext = useCallback(() => {
    if (playing.current) return
    const clip = queue.current.shift()
    if (!clip) { afterSpeech(); return }
    const audio = clip.audio
    playing.current = audio
    setPhase('speaking')
    // Субтитры: текст фразы и блоки перед ней — вместе со звуком.
    if (clip.reveal) revealTai(clip.reveal.replyId, clip.reveal.upTo, clip.reveal.blocks)
    const next = () => { if (playing.current === audio) playing.current = null; playNextRef.current() }
    audio.onended = next
    audio.onerror = next
    void audio.play().catch(next)
  }, [afterSpeech])
  useEffect(() => { playNextRef.current = playNext }, [playNext])
  const enqueue = useCallback((format: 'mp3' | 'wav', data: string, reveal?: { replyId: string; upTo: number; blocks: number }) => {
    if (!conversation.current) return
    queue.current.push({ audio: new Audio(`data:audio/${format === 'mp3' ? 'mpeg' : 'wav'};base64,${data}`), reveal })
    playNext()
  }, [playNext])
  useEffect(() => {
    setTaiAudioListener((clip: TaiAudioClip) => enqueue(clip.format, clip.data, { replyId: clip.replyId, upTo: clip.upTo, blocks: clip.blocks }))
    return () => setTaiAudioListener(null)
  }, [enqueue])

  /** Ответ дописан — когда звук доиграет, снова слушаем. */
  const replyDone = useCallback(() => { replyFinished.current = true; afterSpeech() }, [afterSpeech])
  /** Короткая реплика голосом Tai (итог карточки после голосового «да»). */
  const say = useCallback(async (text: string) => {
    replyFinished.current = false
    if (conversation.current && text) {
      const audio = await speakTai(text)
      if (audio) enqueue(audio.format, audio.data)
    }
    replyDone()
  }, [enqueue, replyDone])

  useEffect(() => () => { conversation.current = false; recognition.current?.abort(); playing.current?.pause() }, [])

  return { phase, transcript, active: phase !== 'idle', listen, done, end, say, replyDone }
}

/* ─────────────────────────── Чат ─────────────────────────── */

export function TaiChat({ onClose, closeOnNavigate = true }: { onClose?: () => void; closeOnNavigate?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const qc = useQueryClient()
  const messages = useTaiStore((s) => s.messages)
  const busy = useTaiStore((s) => s.busy)
  const locked = useTaiStore((s) => s.locked)
  const context = useTaiStore((s) => s.context)
  const send = useTaiStore((s) => s.send)
  const stop = useTaiStore((s) => s.stop)
  const reset = useTaiStore((s) => s.reset)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Действие Tai выполнено — касса и чек перечитывают данные.
  useEffect(() => {
    useTaiStore.setState({ onActionDone: () => void qc.invalidateQueries() })
  }, [qc])

  const open = useCallback((to: TaiRoute) => {
    const href = taiHref(to)
    if (closeOnNavigate) onClose?.()
    // Дашборд читает параметры при открытии — на нём же переходим полной загрузкой.
    if (href.startsWith('/dashboard') && pathname === '/dashboard') window.location.assign(href)
    else router.push(href)
  }, [closeOnNavigate, onClose, pathname, router])

  const voice = useWebVoice(async (text) => {
    await send(text, { voice: true })
    const state = useTaiStore.getState()
    const last = state.messages.at(-1)
    if (last?.role === 'user') {
      const reply = [...state.messages].reverse().find((m): m is TaiReply => m.role === 'tai')
      const card = reply?.blocks.find((b) => b.type === 'action')
      voice.say(card?.type === 'action' ? (card.action.status === 'cancelled' ? 'Отменил.' : card.action.result ?? 'Готово.') : 'Готово.')
    } else {
      voice.replyDone()
    }
  })

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = inputRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`
  }, [draft])

  const submit = (text: string) => {
    if (!text.trim() || busy) return
    setDraft('')
    void send(text)
  }

  const screen = context.screen ?? 'other'
  const starters = STARTERS[screen]
  const lastReply = [...messages].reverse().find((m): m is TaiReply => m.role === 'tai')
  const suggestions = !busy && lastReply && !lastReply.streaming && messages.at(-1)?.role === 'tai' ? lastReply.suggestions : []

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <TaiLogo size={28} animated={false} float={false} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Tai</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-variant)' }}>{busy ? 'печатает…' : 'касса и аналитика'}</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { voice.end(); reset() }} title="Новый диалог" aria-label="Новый диалог" style={iconBtn}><Icon name="edit_square" size={18} /></button>
        )}
        {onClose && <button onClick={() => { voice.end(); onClose() }} title="Закрыть" aria-label="Закрыть" style={iconBtn}><Icon name="close" size={18} /></button>}
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {messages.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0 8px', textAlign: 'center' }}>
              <TaiLogo size={56} float={false} />
              <h2 style={{ margin: 0, fontSize: 21, fontWeight: 800 }}>Чем помочь?</h2>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--on-surface-variant)', maxWidth: 360 }}>{starters.hint}</p>
              <div className="glass-l2" style={{ width: '100%', maxWidth: 460, borderRadius: 16, marginTop: 10, textAlign: 'left' }}>
                {starters.items.map((item, i) => (
                  <button key={item.text} onClick={() => (item.draft ? (setDraft(item.text), inputRef.current?.focus()) : submit(item.text))}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', background: 'none', border: 'none', borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none', color: 'var(--on-surface)', fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                    <Icon name={item.draft ? 'edit' : 'north_east'} size={16} color="var(--primary-violet)" />
                    {item.draft ? `${item.text.trim()}…` : item.text}
                  </button>
                ))}
              </div>
            </div>
          ) : messages.map((m) => <Message key={m.id} message={m} open={open} />)}
        </div>
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(21,18,27,0.9)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {suggestions.length > 0 && !voice.active && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {suggestions.map((s) => (
                <button key={s} onClick={() => submit(s)} style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>{s}</button>
              ))}
            </div>
          )}
          {locked ? (
            <p style={{ margin: 0, padding: 12, fontSize: 13, color: 'var(--on-surface-variant)' }}>Tai не подключён для этого клуба. Подключить можно в «О системе».</p>
          ) : voice.active ? (
            <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 18 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--primary-violet)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: voice.phase === 'listening' || voice.phase === 'recording' ? 'tai-pulse 1.2s ease-in-out infinite' : 'none', flexShrink: 0 }}>
                <Icon name={voice.phase === 'speaking' ? 'volume_up' : 'mic'} size={17} color="#fff" />
              </span>
              <span style={{ flex: 1, fontSize: 14, color: voice.transcript && voice.phase === 'listening' ? 'var(--on-surface)' : 'var(--on-surface-variant)' }}>
                {voice.phase === 'listening' ? voice.transcript || 'Говори…' : voice.phase === 'recording' ? 'Записываю — нажми, когда закончишь' : voice.phase === 'thinking' ? 'Tai думает…' : 'Tai отвечает…'}
              </span>
              {(voice.phase === 'listening' || voice.phase === 'recording') && <button onClick={voice.done} style={sendBtn(true)} aria-label="Готово"><Icon name="arrow_upward" size={20} /></button>}
              <button onClick={voice.end} style={iconBtn} aria-label="Выйти из голосового режима"><Icon name="close" size={18} /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={1}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(draft) } }}
                placeholder="Спроси или попроси действие" aria-label="Сообщение для Tai"
                style={{ flex: 1, resize: 'none', maxHeight: 132, minHeight: 46, padding: '12px 14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', fontSize: 16, lineHeight: 1.4, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              {busy ? (
                <button onClick={stop} style={sendBtn(false)} aria-label="Остановить"><Icon name="stop" size={20} /></button>
              ) : draft.trim() ? (
                <button onClick={() => submit(draft)} style={sendBtn(true)} aria-label="Отправить"><Icon name="arrow_upward" size={20} /></button>
              ) : (
                <button onClick={() => void voice.listen()} style={sendBtn(true)} aria-label="Говорить с Tai голосом" title="Голосом"><Icon name="mic" size={20} /></button>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes tai-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        @keyframes tai-blink { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
        .tai-row:not(:disabled):hover { background: rgba(255,255,255,0.03) !important; }
        @media (prefers-reduced-motion: reduce) { [style*="tai-pulse"], [style*="tai-blink"] { animation: none !important; } }
      `}</style>
    </div>
  )
}

const iconBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }
const sendBtn = (active: boolean): React.CSSProperties => ({ width: 46, height: 46, borderRadius: 14, border: 'none', background: active ? 'var(--primary-violet)' : 'rgba(255,255,255,0.08)', color: active ? '#fff' : 'var(--on-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 })

function Message({ message, open }: { message: TaiMessage; open: (to: TaiRoute) => void }) {
  if (message.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingLeft: 40 }}>
        <div style={{ background: 'var(--primary-violet)', color: '#fff', padding: '10px 14px', borderRadius: '18px 18px 6px 18px', fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.text}</div>
      </div>
    )
  }
  // Голосом — только уже озвученное (как субтитры).
  const text = message.gate ? message.text.slice(0, message.gate.chars).trim() : message.text
  const blocks = message.gate ? message.blocks.slice(0, message.gate.blocks) : message.blocks
  const status = message.gate && message.streaming && !message.status ? 'Tai отвечает…' : message.status
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {text && <RichText text={text} />}
      {blocks.map((block, i) => <TaiBlockView key={i} block={block} open={open} />)}
      {(message.streaming || message.gate) && status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--on-surface-variant)', animation: 'tai-blink 1.4s ease-in-out infinite' }} aria-live="polite">
          <TaiLogo size={18} thinking float={false} /> {status}
        </div>
      )}
      {message.error && <p style={{ margin: 0, fontSize: 14, color: '#F59E0B' }}>{message.error}</p>}
    </div>
  )
}

function RichText({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15, lineHeight: 1.55 }}>
      {text.split('\n').map((line, i) => {
        const t = line.trim()
        if (!t) return <div key={i} style={{ height: 4 }} />
        const bullet = /^([-*•]|\d+[.)])\s+/.exec(t)
        const body = (bullet ? t.slice(bullet[0].length) : t.replace(/^#+\s+/, '')).split('**').map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))
        return bullet ? (
          <div key={i} style={{ display: 'flex', gap: 8 }}><span style={{ color: 'var(--on-surface-variant)' }}>{/^\d/.test(bullet[0]) ? bullet[0].trim() : '•'}</span><span>{body}</span></div>
        ) : <p key={i} style={{ margin: 0, fontWeight: /^#+\s/.test(t) ? 700 : 400 }}>{body}</p>
      })}
    </div>
  )
}
