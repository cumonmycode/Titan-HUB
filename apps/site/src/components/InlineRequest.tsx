'use client'
/** Встроенная форма заявки на странице (сертификат, контакты) — без шторки. */
import type { RequestPreset } from '@/lib/types'
import { RequestForm } from './request/RequestForm'
import { useRequest } from './request/RequestProvider'

/** lockKind=false — гость может сменить вид заявки (страница онлайн-записи /book). */
export function InlineRequest({ preset, lockKind = true }: { preset: RequestPreset; lockKind?: boolean }) {
  const { config } = useRequest()
  return <RequestForm config={config} preset={preset} variant="inline" lockKind={lockKind} />
}
