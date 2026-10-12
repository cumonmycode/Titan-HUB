'use client'
/**
 * «Сайт → Публикации»: турниры, вечеринки и события клуба с фото. Опубликованные
 * видны на titanmafia.ru в «Турнирах» и на своих страницах (titanmafia.ru/<адрес>).
 */
import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Button, ConfirmDialog, Sheet } from '@/components/manage/DesignSystem'
import { EMPTY_DRAFT, SITE_MIRROR, STORY_KINDS, draftOf, photoSrc, type Story, type StoryDraft } from '@/lib/site'
import { StoryEditor } from './StoryEditor'

const KEY = ['site-stories']

function payload(d: StoryDraft) {
  return { ...d, stats: d.stats.filter((s) => s.value.trim() && s.label.trim()) }
}

export function SiteStories({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (v: boolean) => void }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: KEY, queryFn: () => api.get<{ stories: Story[] }>('/site-admin/stories') })
  const [editing, setEditing] = useState<Story | null>(null)
  const [draft, setDraft] = useState<StoryDraft>(EMPTY_DRAFT)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const open = creating || !!editing

  const close = () => { setEditing(null); onCreatingChange(false); setConfirmDelete(false) }
  const startEdit = (s: Story) => { setDraft(draftOf(s)); setEditing(s) }
  // «Добавить» в шапке открывает пустой черновик.
  useEffect(() => {
    if (creating) { setEditing(null); setDraft(EMPTY_DRAFT) }
  }, [creating])

  const save = useMutation({
    mutationFn: () => (editing
      ? api.patch<{ story: Story }>(`/site-admin/stories/${editing.id}`, payload(draft))
      : api.post<{ story: Story }>('/site-admin/stories', payload(draft))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); show(draft.isPublished ? 'Опубликовано — на сайте через минуту' : 'Сохранено как черновик', 'success'); close() },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить', 'error'),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/site-admin/stories/${editing!.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); show('Публикация удалена', 'success'); close() },
    onError: (e: Error) => show(e.message || 'Не удалось удалить', 'error'),
  })

  const stories = data?.stories ?? []
  const canSave = draft.title.trim() && /^[a-z0-9][a-z0-9-]{1,39}$/.test(draft.slug)

  return (
    <>
      {isLoading ? <StateView state="loading" />
        : isError ? <StateView state="error" title="Публикации не загрузились" action={{ label: 'Повторить', onClick: () => void refetch() }} />
        : stories.length === 0 ? <StateView state="empty" icon="photo_library" title="Публикаций пока нет" description="Добавьте турнир или вечеринку: фото, цифры и ссылку на папку Google Drive." />
        : stories.map((s) => {
          const cover = s.cover_url ?? s.photos[0]
          return (
            <button key={s.id} type="button" onClick={() => startEdit(s)} className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12, borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
              <div style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cover ? <img src={photoSrc(cover)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="image" size={22} color="var(--on-surface-variant)" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</p>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--on-surface-variant)' }}>
                  {STORY_KINDS.find((k) => k.id === s.kind)?.label ?? 'Событие'} · /{s.slug} · {s.photos.length} фото{s.gallery_url ? ' · Google Drive' : ''}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: s.is_published ? '#22C55E' : '#F59E0B' }}>{s.is_published ? 'На сайте' : 'Черновик'}</p>
              </div>
              <Icon name="chevron_right" size={18} color="var(--on-surface-variant)" />
            </button>
          )
        })}

      <Sheet open={open} onClose={close} title={editing ? 'Публикация' : 'Новая публикация'} desktopSize="lg" initialHeight="88dvh" maxHeight="94dvh">
        <StoryEditor key={editing?.id ?? 'new'} value={draft} onChange={setDraft} isNew={!editing} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '6px 0 12px' }}>
          <div style={{ flex: 2, minWidth: 180 }}><Button fullWidth loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>Сохранить</Button></div>
          {editing && <a href={`${SITE_MIRROR}/${editing.slug}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 120, textDecoration: 'none' }}><Button variant="secondary" fullWidth>На сайте</Button></a>}
          {editing && <div style={{ flex: 1, minWidth: 120 }}><Button variant="danger" fullWidth onClick={() => setConfirmDelete(true)}>Удалить</Button></div>}
        </div>
      </Sheet>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => remove.mutate()}
        title="Удалить публикацию?" message="Страница исчезнет с сайта. Фото в Google Drive останутся." confirmLabel="Удалить" danger loading={remove.isPending} />
    </>
  )
}
