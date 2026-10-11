// Типографика: Inter, цифры табличные. Жирность задаётся семейством шрифта —
// на Android fontWeight для своих шрифтов не работает.
import type { ReactNode } from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { color, font } from './tokens';

export type TextVariant = 'display' | 'title' | 'heading' | 'subheading' | 'body' | 'label' | 'caption' | 'overline' | 'small';
export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'onAccent' | 'green' | 'amber' | 'red' | 'cool' | 'warm';

const TONE: Record<TextTone, string> = {
  primary: color.text,
  secondary: color.textSecondary,
  tertiary: color.textTertiary,
  accent: color.accentSoft,
  onAccent: color.onAccent,
  green: color.green,
  amber: color.amber,
  red: color.red,
  cool: color.cool,
  warm: color.warm,
};

export function T({
  variant = 'body', tone = 'primary', numeric, style, children, ...rest
}: TextProps & { variant?: TextVariant; tone?: TextTone; numeric?: boolean; children?: ReactNode }) {
  return (
    <Text
      {...rest}
      style={[styles[variant], { color: TONE[tone] }, numeric && styles.numeric, style as TextStyle]}
      allowFontScaling={false}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  display: { fontFamily: font.semibold, fontSize: 76, lineHeight: 84, letterSpacing: -2.5 },
  title: { fontFamily: font.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  heading: { fontFamily: font.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  subheading: { fontFamily: font.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: font.regular, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: font.semibold, fontSize: 16, lineHeight: 20 },
  caption: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
  small: { fontFamily: font.medium, fontSize: 13, lineHeight: 17 },
  overline: { fontFamily: font.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1.4, textTransform: 'uppercase' },
  numeric: { fontVariant: ['tabular-nums'] },
});
