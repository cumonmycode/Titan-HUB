// Обратная сторона карты: та же текстура, приглушённая, магнитная полоса и подпись.
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import type { FaceLook } from './faces';
import type { ClubCardData } from './shared';

const FS = 1.15;

export function CardBack({ look, data }: { look: FaceLook; data: ClubCardData }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image source={look.texture} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
      <View style={styles.stripe} />
      <View style={styles.body}>
        <View style={styles.signature}>
          <Text maxFontSizeMultiplier={FS} style={styles.signatureText} numberOfLines={1}>@{data.nickname || 'гость'}</Text>
        </View>
        <Text maxFontSizeMultiplier={FS} style={[styles.caption, { color: look.muted }]}>
          Карта клуба Titan. Назовите ник на кассе — бонусы начислятся сами.
        </Text>
        <Text maxFontSizeMultiplier={FS} style={[styles.brand, { color: look.ink }]}>TITAN</Text>
      </View>
      <View style={[StyleSheet.absoluteFill, styles.edge]} />
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: 'rgba(0,0,0,0.18)' },
  stripe: { marginTop: '9%', height: '19%', backgroundColor: '#0d0c10' },
  body: { flex: 1, paddingHorizontal: 20, paddingVertical: 14, justifyContent: 'space-between' },
  signature: {
    alignSelf: 'flex-start', width: '62%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4,
    backgroundColor: '#efece4',
  },
  signatureText: { color: '#2a2833', fontSize: 15, fontStyle: 'italic', fontWeight: '600' },
  caption: { fontSize: 11.5, fontWeight: '500', lineHeight: 15 },
  brand: { alignSelf: 'flex-end', fontSize: 13, fontWeight: '800', letterSpacing: 4 },
  edge: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
});
