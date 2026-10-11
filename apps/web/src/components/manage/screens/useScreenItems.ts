'use client'
/**
 * Правка элементов экрана — показа (placement 'show') или рекламы ленты ('band'):
 * добавить, изменить (сразу в кэше), удалить, переставить. Общая часть ScreenShow и
 * ScreenSlides. ТВ подхватывает изменения в течение 20 секунд.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { SCREENS_KEY, screenKey, type Fit, type Placement, type ScreenDetail, type ScreenSlide, type Transition } from '@/lib/screens'

export type NewItem = {
  kind: ScreenSlide['kind']
  imageUrl?: string | null
  title?: string | null
  body?: string | null
  linkUrl?: string | null
  durationSec: number
  transition?: Transition
  transitionMs?: number
  fit?: Fit
}

export function useScreenItems(screenId: string, placement: Placement) {
  const qc = useQueryClient()
  const { show: toast } = useToast()
  const base = `/screens/${screenId}/slides`
  const key = screenKey(screenId)
  const field = placement === 'show' ? 'show' : 'slides'

  // Список экранов тоже: в нём сводка показа («Меню и 2 картинки»).
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: SCREENS_KEY, exact: true })
  }
  const fail = (e: unknown) => toast(e instanceof Error && e.message ? e.message : 'Не удалось сохранить', 'error')
  const patchCache = (fn: (items: ScreenSlide[]) => ScreenSlide[]) =>
    qc.setQueryData<ScreenDetail>(key, (old) => (old ? { ...old, [field]: fn(old[field]) } : old))

  const create = useMutation({
    mutationFn: (item: NewItem) => api.post(base, { ...item, placement }),
    onError: fail,
    onSettled: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<ScreenSlide> & { id: string }) => api.patch(`${base}/${id}`, patch),
    onMutate: ({ id, ...patch }) => patchCache((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    onError: (e) => { fail(e); refresh() },
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onError: fail,
    onSettled: refresh,
  })
  const reorder = useMutation({
    mutationFn: (items: { id: string; sortOrder: number }[]) => api.patch(`${base}/reorder`, { items }),
    onMutate: (items) => {
      const order = new Map(items.map((i) => [i.id, i.sortOrder]))
      patchCache((all) => all.map((x) => ({ ...x, sortOrder: order.get(x.id) ?? x.sortOrder })).sort((a, b) => a.sortOrder - b.sortOrder))
    },
    onError: (e) => { fail(e); refresh() },
    onSettled: refresh,
  })

  /** Сдвинуть элемент списка на позицию выше/ниже. */
  const move = (list: ScreenSlide[], index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= list.length) return
    const next = list.slice()
    const [it] = next.splice(index, 1)
    next.splice(j, 0, it!)
    reorder.mutate(next.map((s, i) => ({ id: s.id, sortOrder: i })))
  }

  return { create, update, remove, move, fail, toast }
}
