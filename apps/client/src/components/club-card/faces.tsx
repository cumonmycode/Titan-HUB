// Виды карты клуба на настоящих текстурах (assets/images/cards, сгенерированы заранее):
// шлифованный металл, «Аврора», «Оникс» с гильошем и голограммой, «Карбон».
// Блик, параллакс и голограмма двигаются от наклона (tx, ty: −1…1).
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { RollingNumber } from '@/components/rolling-number';
import type { CardStyle } from '@/lib/card-style';
import { bonus as fmtBonus } from '@/lib/format';

import { CARD_RATIO, type FaceProps } from './shared';

/** Карта фиксированной высоты: крупный системный шрифт растёт не больше чем на 15 %. */
const FS = 1.15;
// Локальная копия для worklet-ов (они захватывают значения, а не модули).
const RATIO = CARD_RATIO;

export interface FaceLook {
  texture: number;
  ink: string;
  muted: string;
  /** Гравировка: светлая тень снизу (на светлом металле) или тёмная сверху. */
  engrave: 'light' | 'dark';
  sheen: 'band' | 'glare';
  sheenOpacity: number;
  /** Текстура больше карты и сдвигается при наклоне («Аврора»). */
  parallax?: boolean;
  /** Голографическая наклейка («Оникс»). */
  holo?: boolean;
  pillBorder: string;
  pillFill: string;
}

export const LOOKS: Record<CardStyle, FaceLook> = {
  titanium: {
    texture: require('../../../assets/images/cards/titanium.jpg'), ink: '#26252b', muted: 'rgba(38,37,43,0.55)',
    engrave: 'light', sheen: 'band', sheenOpacity: 0.55, pillBorder: 'rgba(38,37,43,0.32)', pillFill: 'transparent',
  },
  graphite: {
    texture: require('../../../assets/images/cards/graphite.jpg'), ink: '#efeef3', muted: 'rgba(239,238,243,0.58)',
    engrave: 'dark', sheen: 'band', sheenOpacity: 0.22, pillBorder: 'rgba(255,255,255,0.28)', pillFill: 'transparent',
  },
  gold: {
    texture: require('../../../assets/images/cards/gold.jpg'), ink: '#3d2f13', muted: 'rgba(61,47,19,0.58)',
    engrave: 'light', sheen: 'band', sheenOpacity: 0.5, pillBorder: 'rgba(61,47,19,0.32)', pillFill: 'transparent',
  },
  aurora: {
    texture: require('../../../assets/images/cards/aurora.jpg'), ink: '#ffffff', muted: 'rgba(255,255,255,0.66)',
    engrave: 'dark', sheen: 'glare', sheenOpacity: 0.7, parallax: true, pillBorder: 'transparent', pillFill: 'rgba(255,255,255,0.16)',
  },
  onyx: {
    texture: require('../../../assets/images/cards/onyx.jpg'), ink: '#e9e7ef', muted: 'rgba(233,231,239,0.52)',
    engrave: 'dark', sheen: 'glare', sheenOpacity: 0.4, holo: true, pillBorder: 'rgba(255,255,255,0.22)', pillFill: 'transparent',
  },
  carbon: {
    texture: require('../../../assets/images/cards/carbon.jpg'), ink: '#f3f2f6', muted: 'rgba(243,242,246,0.58)',
    engrave: 'dark', sheen: 'band', sheenOpacity: 0.16, pillBorder: 'rgba(255,255,255,0.26)', pillFill: 'transparent',
  },
};

const HOLO = require('../../../assets/images/cards/holo.jpg');

type TiltProps = Pick<FaceProps, 'tx' | 'ty' | 'width'>;

/** Узкая полоса отражения, бегущая по шлифованному металлу против наклона. */
function Band({ tx, ty, width, opacity }: TiltProps & { opacity: number }) {
  const style = useAnimatedStyle(() => {
    const w = width.get();
    return { width: w * 2.2, transform: [{ translateX: -w * 0.6 - tx.get() * w * 0.55 }, { translateY: -ty.get() * 14 }] };
  });
  return <Animated.View style={[styles.band, { opacity }, style]} />;
}

/** Мягкое пятно света, скользящее против наклона. */
function Glare({ tx, ty, width, opacity }: TiltProps & { opacity: number }) {
  const style = useAnimatedStyle(() => {
    const w = width.get();
    const h = w / RATIO;
    const size = w * 1.6;
    return {
      width: size,
      height: size,
      transform: [
        { translateX: w * 0.5 - size / 2 - tx.get() * w * 0.45 },
        { translateY: h * 0.2 - size / 2 - ty.get() * h * 0.55 },
      ],
    };
  });
  return <Animated.View style={[styles.glare, { opacity }, style]} />;
}

/** Текстура больше карты: при наклоне она сдвигается — цвета «перетекают». */
function ParallaxTexture({ source, tx, ty, width }: TiltProps & { source: number }) {
  const style = useAnimatedStyle(() => {
    const w = width.get();
    return { transform: [{ translateX: -w * 0.1 - tx.get() * w * 0.08 }, { translateY: -(w / RATIO) * 0.1 - ty.get() * (w / RATIO) * 0.08 }] };
  });
  return (
    <Animated.View style={[styles.oversize, style]}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}

/** Голографическая наклейка: радужная дифракция переливается при наклоне. */
function Hologram({ tx, ty }: Pick<FaceProps, 'tx' | 'ty'>) {
  const shift = useAnimatedStyle(() => ({
    opacity: 0.35 + Math.max(Math.abs(tx.get()), Math.abs(ty.get())) * 0.45,
    transform: [{ translateX: -60 + tx.get() * 40 }, { translateY: ty.get() * 10 }],
  }));
  return (
    <View style={styles.holo}>
      <Image source={HOLO} style={StyleSheet.absoluteFill} contentFit="cover" />
      <Animated.View style={[styles.holoShift, shift]} />
    </View>
  );
}

export function CardFace({ look, data, tx, ty, width }: FaceProps & { look: FaceLook }) {
  const engraved = look.engrave === 'light' ? styles.engraveLight : styles.engraveDark;
  const ink = { color: look.ink };
  const muted = { color: look.muted };
  return (
    <View style={StyleSheet.absoluteFill}>
      {look.parallax
        ? <ParallaxTexture source={look.texture} tx={tx} ty={ty} width={width} />
        : <Image source={look.texture} style={StyleSheet.absoluteFill} contentFit="cover" />}
      {look.sheen === 'band'
        ? <Band tx={tx} ty={ty} width={width} opacity={look.sheenOpacity} />
        : <Glare tx={tx} ty={ty} width={width} opacity={look.sheenOpacity} />}
      <View style={[StyleSheet.absoluteFill, styles.edge]} />
      <View style={styles.content}>
        <View style={styles.row}>
          <Text maxFontSizeMultiplier={FS} style={[styles.brand, ink, engraved]}>TITAN</Text>
          <View style={[styles.pill, { borderColor: look.pillBorder, backgroundColor: look.pillFill }]}>
            <Text maxFontSizeMultiplier={FS} style={[styles.pillText, ink]} numberOfLines={1}>{data.tierLabel}</Text>
          </View>
        </View>
        {look.holo ? <Hologram tx={tx} ty={ty} /> : <View />}
        <View style={styles.bottom}>
          <Text maxFontSizeMultiplier={FS} style={[styles.nick, ink, engraved]} numberOfLines={1}>@{data.nickname || 'гость'}</Text>
          {data.bonusHidden ? null : (
            <View style={styles.field}>
              <Text maxFontSizeMultiplier={FS} style={[styles.label, muted]}>Бонусы</Text>
              <RollingNumber value={data.bonus} format={fmtBonus} style={[styles.value, ink, engraved]} maxFontSizeMultiplier={FS} />
              {data.expiring ? <Text maxFontSizeMultiplier={FS} style={[styles.expiring, muted]} numberOfLines={1}>{data.expiring}</Text> : null}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 20, justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  edge: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  oversize: { position: 'absolute', top: 0, left: 0, width: '120%', height: '120%' },
  band: {
    position: 'absolute', top: -20, bottom: -20, left: 0,
    experimental_backgroundImage:
      'linear-gradient(100deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.35) 48%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0.35) 52%, rgba(255,255,255,0) 62%)',
  },
  glare: {
    position: 'absolute', top: 0, left: 0, borderRadius: 9999,
    experimental_backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.07) 35%, rgba(255,255,255,0) 62%)',
  },
  holo: {
    width: 46, height: 34, borderRadius: 6, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)',
  },
  holoShift: {
    position: 'absolute', top: -10, bottom: -10, left: 0, width: 180, mixBlendMode: 'color-dodge',
    experimental_backgroundImage: 'linear-gradient(110deg, #c4b5fd 0%, #94d0ff 25%, #6ef0c8 45%, #ffe27a 65%, #ff9ad5 85%, #c4b5fd 100%)',
  },
  brand: { fontSize: 16, fontWeight: '800', letterSpacing: 5 },
  engraveLight: { textShadowColor: 'rgba(255,255,255,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0 },
  engraveDark: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: -1 }, textShadowRadius: 0 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, maxWidth: 160 },
  pillText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  nick: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  field: { alignItems: 'flex-end' },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase' },
  value: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 1 },
  expiring: { fontSize: 11, fontWeight: '600', marginTop: 1 },
});
