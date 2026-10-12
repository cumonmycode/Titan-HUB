'use client'
import type { ReactNode } from 'react'
import type { RequestPreset } from '@/lib/types'
import { useRequest } from './RequestProvider'

/** Кнопка, открывающая шторку заявки с нужным видом и предзаполнением. */
export function RequestButton({ preset, className, children }: { preset: RequestPreset; className?: string; children: ReactNode }) {
  const { open } = useRequest()
  return <button type="button" className={className} onClick={() => open(preset)}>{children}</button>
}
