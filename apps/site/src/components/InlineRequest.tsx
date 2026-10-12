'use client'
/** Встроенная форма заявки на странице (сертификат, контакты) — без шторки. */
import type { RequestPreset } from '@/lib/types'
import { RequestForm } from './request/RequestForm'
import { useRequest } from './request/RequestProvider'

export function InlineRequest({ preset }: { preset: RequestPreset }) {
  const { config } = useRequest()
  return <RequestForm config={config} preset={preset} variant="inline" lockKind />
}
