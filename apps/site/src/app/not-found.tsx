import Link from 'next/link'
import { getSiteConfig } from '@/lib/hub'
import { ThemeFrame } from '@/components/chrome/ThemeFrame'
import { PageHead } from '@/components/sections/blocks'

export default async function NotFound() {
  const config = await getSiteConfig()
  return (
    <ThemeFrame theme={config.theme} config={config}>
      <PageHead title="Такой страницы нет" lead="Возможно, мафия её убрала. Вернитесь на главную или посмотрите турниры клуба."
        actions={<><Link className="btn btn-primary" href="/">На главную</Link><Link className="btn btn-ghost" href="/portfolio">Турниры</Link></>} />
    </ThemeFrame>
  )
}
