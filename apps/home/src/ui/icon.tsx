// Линейные иконки (lucide) с общей толщиной штриха.
import type { LucideIcon } from 'lucide-react-native';

import { color } from './tokens';

export type IconType = LucideIcon;

export function Icon({ as: Cmp, size = 24, tone = color.text, stroke = 1.8 }: { as: LucideIcon; size?: number; tone?: string; stroke?: number }) {
  return <Cmp size={size} color={tone} strokeWidth={stroke} absoluteStrokeWidth={false} />;
}
