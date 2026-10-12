import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import type { Rotation, ScreenSlide } from '@/lib/screens-api';

/** Цвета тем меню ТВ — фон, акцент и текст, как на самом экране (public/tv-menu.html). */
const SWATCH: Record<string, { bg: string; accent: string; ink: string }> = {
  night: { bg: '#0B1020', accent: '#A78BFA', ink: '#E5E7EB' },
  neon: { bg: '#0D0221', accent: '#FF2BD6', ink: '#F5D0FE' },
  deco: { bg: '#12100C', accent: '#D4AF37', ink: '#F5E6C8' },
  synth: { bg: '#1A0B2E', accent: '#FF7AC6', ink: '#FBCFE8' },
  avant: { bg: '#F2EDE4', accent: '#D7262B', ink: '#1F1F1F' },
  dossier: { bg: '#E9E4D8', accent: '#3A3A3A', ink: '#222222' },
  halloween: { bg: '#120A05', accent: '#FF7518', ink: '#FDE7D3' },
};
export const swatchOf = (theme: string) => SWATCH[theme] ?? SWATCH.night!;

/**
 * Превью телевизора: рамка по повороту (горизонтально или вертикально), внутри — первая
 * картинка показа или схема меню в цветах темы. Не живой экран, а понятный образ.
 * width — сколько места есть; вертикальный ТВ занимает его по высоте.
 */
export function ScreenPreview({ rotation, theme, first, width, status }: { rotation: Rotation; theme: string; first?: ScreenSlide | null; width: number; status?: { label: string; color: string } }) {
  const vertical = rotation !== 0;
  const swatch = swatchOf(theme);
  const frameWidth = vertical ? Math.round((Math.min(width * 1.15, 320) * 9) / 16) : width;
  const frameHeight = vertical ? Math.round((frameWidth * 16) / 9) : Math.round((width * 9) / 16);
  const image = first?.kind === 'image' && first.imageUrl ? first.imageUrl : null;
  const lines = vertical ? 8 : 4;

  return (
    <View style={[styles.frame, { width: frameWidth, height: frameHeight, backgroundColor: swatch.bg }]}>
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit={first?.fit === 'cover' ? 'cover' : 'contain'} transition={150} />
      ) : (
        <View style={styles.menu}>
          <Text style={[styles.menuTitle, { color: swatch.accent }]}>МЕНЮ</Text>
          {Array.from({ length: lines }, (_, i) => (
            <View key={i} style={styles.menuLine}>
              <View style={[styles.bar, { backgroundColor: swatch.ink, width: `${45 + ((i * 17) % 30)}%` }]} />
              <View style={[styles.price, { backgroundColor: swatch.accent }]} />
            </View>
          ))}
          <View style={[styles.band, { borderColor: swatch.accent }]} />
        </View>
      )}
      {status ? (
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Text style={styles.statusText} numberOfLines={1}>
            {status.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#111',
  },
  menu: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: '8%', gap: 6 },
  menuTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 4 },
  menuLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bar: { height: 5, borderRadius: 3, opacity: 0.75 },
  price: { width: '14%', height: 5, borderRadius: 3 },
  band: { position: 'absolute', left: '8%', right: '8%', bottom: '6%', height: '11%', borderRadius: 6, borderWidth: 1.5, opacity: 0.8 },
  status: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: '90%',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: 'white', fontSize: 11, fontWeight: '600' },
});
