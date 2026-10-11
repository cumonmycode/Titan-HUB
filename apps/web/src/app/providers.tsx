'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Component, useState, type ReactNode } from 'react'
import { ToastProvider } from '@/components/Toast'
import { NotificationsProvider } from '@/components/NotificationsProvider'
import { ClubGate } from '@/components/ClubGate'
import { TaiPanel } from '@/components/tai/TaiPanel'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: unknown, info: unknown) {
    console.error('UI error boundary caught:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', color: 'var(--on-surface)' }}>
          <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Что-то пошло не так</p>
          <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: 0 }}>Произошла ошибка интерфейса. Перезагрузите страницу.</p>
          <button
            onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
            style={{ padding: '12px 24px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 14, fontWeight: 700 }}
          >
            Перезагрузить
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60_000,   // 2 минуты — данные при навигации по вкладкам выглядят свежими
            gcTime: 30 * 60_000,     // 30 минут — кэш живёт долго, навигация по вкладкам мгновенная
            retry: 2,
            refetchOnWindowFocus: true,
          },
        },
      })
  )

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ClubGate>
            <NotificationsProvider>
              {children}
              {/* Tai — панель поверх любого экрана (касса, чек, аналитика). */}
              <TaiPanel />
            </NotificationsProvider>
          </ClubGate>
        </ToastProvider>
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
