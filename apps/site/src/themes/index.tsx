import type { ThemeId } from '@/lib/types'
import type { HomeProps } from './types'
import { CaseHome } from './CaseHome'
import { ProtocolHome } from './ProtocolHome'
import { NightHome } from './NightHome'
import { ClassicHome } from './ClassicHome'

export const THEME_LABEL: Record<ThemeId, string> = {
  case: 'Дело о мафии',
  protocol: 'Протокол судьи',
  night: 'Город засыпает',
  classic: 'Классика',
}

export function Home({ theme, ...props }: HomeProps & { theme: ThemeId }) {
  switch (theme) {
    case 'protocol': return <ProtocolHome {...props} />
    case 'night': return <NightHome {...props} />
    case 'classic': return <ClassicHome {...props} />
    default: return <CaseHome {...props} />
  }
}
