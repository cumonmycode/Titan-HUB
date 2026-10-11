// Стеклянные поверхности. Глубину даёт ступень заливки и светлая верхняя кромка,
// а не тень: размытых теней в приложении нет (на Adreno 610 они стоили кадров).
// Кромка другого цвета есть только у крупных панелей: разноцветную скруглённую
// рамку Android рисует контурами (медленно), а мелких плиток и кнопок на экране
// десятки — у них рамка одного цвета (быстрый путь drawRoundRect).
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { color, radius as R } from './tokens';

export type GlassKind = 'panel' | 'control' | 'raised' | 'inset' | 'overlay' | 'accent' | 'warm' | 'amber' | 'cool';

const KIND: Record<GlassKind, ViewStyle> = {
  panel: { backgroundColor: color.glassPanel, borderColor: color.border, borderTopColor: color.highlight },
  control: { backgroundColor: color.glassControl, borderColor: color.borderStrong },
  raised: { backgroundColor: color.glassRaised, borderColor: 'rgba(255,255,255,0.22)' },
  inset: { backgroundColor: color.glassInset, borderColor: 'transparent' },
  overlay: { backgroundColor: color.glassOverlay, borderColor: color.borderStrong, borderTopColor: 'rgba(255,255,255,0.30)' },
  accent: { backgroundColor: color.accentFill, borderColor: color.accentBorder },
  warm: { backgroundColor: color.warmTint, borderColor: color.warmBorder },
  amber: { backgroundColor: color.amberTint, borderColor: color.amberBorder },
  cool: { backgroundColor: color.glassPanel, borderColor: 'rgba(143,216,248,0.28)', borderTopColor: color.highlight },
};

export function Glass({
  kind = 'panel', radius = R.panel, style, children, ...rest
}: ViewProps & { kind?: GlassKind; radius?: number; children?: ReactNode }) {
  return (
    <View {...rest} style={[styles.base, KIND[kind], { borderRadius: radius }, style]}>
      {children}
    </View>
  );
}

/** Стиль стекла для собственных компонентов (например, анимированных). */
export function glassStyle(kind: GlassKind, radius: number = R.panel): ViewStyle {
  return { ...styles.base, ...KIND[kind], borderRadius: radius };
}

const styles = StyleSheet.create({
  base: { borderWidth: 1 },
});
