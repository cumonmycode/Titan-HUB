'use client'
/**
 * Tai — настройки ассистента клуба: голос (с примером), скорость речи и манера.
 * Меняет владелец; сохраняется сразу.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { Chip, PageHeader, Toggle } from '@/components/manage/DesignSystem'
import { getTaiSettings, saveTaiSettings, speakTai, type TaiSettings, type TaiSettingsResponse, type TaiVoiceOption } from '@/lib/tai'

const SAMPLE = 'Привет, это Tai. Сегодня около сорока восьми тысяч выручки и тридцать один чек — для субботы неплохо, дожмём.'
const KEY = ['ai', 'settings']

export default function TaiSettingsPage() {
  const qc = useQueryClient()
  const { data, error } = useQuery({ queryKey: KEY, queryFn: getTaiSettings })
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: saveTaiSettings,
    onMutate: (patch: Partial<TaiSettings>) => {
      const previous = qc.getQueryData<TaiSettingsResponse>(KEY)
      if (previous) qc.setQueryData<TaiSettingsResponse>(KEY, { ...previous, settings: { ...previous.settings, ...patch } })
      setSaveError(null)
      return { previous }
    },
    onError: (e, _patch, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous)
      setSaveError(e instanceof Error ? e.message : 'Не сохранилось')
    },
  })

  const preview = async (voice: TaiVoiceOption, speed: number) => {
    setPreviewing(voice.id)
    const audio = await speakTai(SAMPLE, { voice: voice.id, speed })
    setPreviewing(null)
    if (!audio) return setSaveError('Голос не ответил — попробуйте ещё раз')
    void new Audio(`data:audio/${audio.format === 'mp3' ? 'mpeg' : 'wav'};base64,${audio.data}`).play()
  }

  const settings = data?.settings
  const current = data?.voices.find((v) => v.id === settings?.voice)
  const card: React.CSSProperties = { borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }
  const caption: React.CSSProperties = { fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }

  return (
    <div>
      <PageHeader title="Tai" subtitle="Голос, скорость речи, манера" />
      <div style={{ maxWidth: 'var(--content-narrow)', margin: '0 auto', padding: '16px 16px var(--bottom-nav-clear)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!data || !settings ? (
          <p style={caption}>{error ? 'Не удалось загрузить настройки' : 'Загружаем…'}</p>
        ) : (
          <>
            {saveError && <p style={{ ...caption, color: '#F43F5E' }}>{saveError}</p>}
            <section className="glass-l2" style={card}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Голос</h2>
              <p style={caption}>▶ — пример этим голосом с выбранной скоростью. Нажмите на голос, чтобы выбрать.</p>
              {data.voices.map((voice) => {
                const selected = voice.id === settings.voice
                return (
                  <div key={voice.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 12, background: selected ? 'rgba(139,92,246,0.12)' : 'transparent', border: `1px solid ${selected ? 'rgba(139,92,246,0.4)' : 'transparent'}` }}>
                    <button onClick={() => void preview(voice, settings.speed)} aria-label={`Прослушать голос ${voice.label}`} disabled={previewing !== null}
                      style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--primary-violet)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, opacity: previewing && previewing !== voice.id ? 0.5 : 1 }}>
                      <Icon name={previewing === voice.id ? 'hourglass_top' : 'play_arrow'} size={20} />
                    </button>
                    <button onClick={() => save.mutate({ voice: voice.id })} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'var(--on-surface)', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{voice.label}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--on-surface-variant)' }}>{voice.hint}</span>
                      </span>
                      {selected && <Icon name="check" size={18} color="var(--primary-violet)" />}
                    </button>
                  </div>
                )
              })}
            </section>

            <section className="glass-l2" style={card}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Скорость речи</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.speeds.map((s) => (
                  <Chip key={s.value} active={settings.speed === s.value} onClick={() => save.mutate({ speed: s.value })}>{s.label}</Chip>
                ))}
              </div>
              <p style={caption}>{current?.tunable === false ? 'У этого голоса скорость не настраивается — он говорит в своём темпе.' : 'Как быстро Tai говорит в голосовом режиме.'}</p>
              {current && (
                <button onClick={() => void preview(current, settings.speed)} disabled={previewing !== null}
                  style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--primary-violet)', fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  <Icon name="play_circle" size={18} /> Прослушать с этой скоростью
                </button>
              )}
            </section>

            <section className="glass-l2" style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Можно материться</h2>
                  <p style={caption}>Tai общается на «ты», просто и по делу. Мат — к месту и никогда в адрес гостей.</p>
                </div>
                <Toggle value={settings.profanity} onChange={(on: boolean) => save.mutate({ profanity: on })} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
