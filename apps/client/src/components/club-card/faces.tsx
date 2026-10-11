// Три вида карты клуба. Блики и фольга двигаются от наклона (tx, ty: −1…1):
// свет как будто висит над телефоном, а карта под ним поворачивается.
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { RollingNumber } from '@/components/rolling-number';
import { bonus as fmtBonus, money } from '@/lib/format';

import { CARD_RATIO, type FaceProps } from './shared';

/** Карта фиксированной высоты: крупный системный шрифт растёт не больше чем на 15 %. */
const FS = 1.15;
// Локальная копия для worklet-ов (они захватывают значения, а не модули).
const RATIO = CARD_RATIO;
const HIDDEN_BONUS = 'Скоро здесь появятся бонусы';

/** Мягкое пятно света, которое скользит по карте против наклона. */
function Glare({ tx, ty, width, opacity }: Pick<FaceProps, 'tx' | 'ty' | 'width'> & { opacity: number }) {
  const style = useAnimatedStyle(() => {
    const w = width.get();
    const h = w / RATIO;
    const size = w * 1.6;
    return {
      width: size,
      height: size,
      transform: [
        { translateX: w * 0.5 - size / 2 - tx.get() * w * 0.45 },
        { translateY: h * 0.25 - size / 2 - ty.get() * h * 0.55 },
      ],
    };
  });
  return <Animated.View style={[styles.glare, { opacity }, style]} />;
}

/** Номинал бонусов: крупно, с прокруткой цифр при изменении. */
function BonusValue({ value, hidden, engraved }: { value: number; hidden: boolean; engraved?: boolean }) {
  if (hidden) return <Text maxFontSizeMultiplier={FS} style={styles.hidden}>{HIDDEN_BONUS}</Text>;
  return <RollingNumber value={value} format={fmtBonus} style={[styles.bonus, engraved && styles.engraved]} maxFontSizeMultiplier={FS} />;
}

// ── Металл: графитовый титан со шлифовкой и бегущим бликом ─────────────────────
export function MetalFace({ data, tx, ty, width }: FaceProps) {
  const band = useAnimatedStyle(() => {
    const w = width.get();
    return {
      width: w * 2.2,
      transform: [{ translateX: -w * 0.6 - tx.get() * w * 0.55 }, { translateY: -ty.get() * 18 }],
    };
  });
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, styles.metalBase]} />
      <View style={[StyleSheet.absoluteFill, styles.metalBrush]} />
      <Animated.View style={[styles.metalBand, band]} />
      <Glare tx={tx} ty={ty} width={width} opacity={0.55} />
      <View style={[StyleSheet.absoluteFill, styles.edge]} />
      <View style={styles.content}>
        <View style={styles.row}>
          <Text maxFontSizeMultiplier={FS} style={[styles.brand, styles.engraved]}>TITAN</Text>
          <View style={styles.tierOutline}>
            <View style={[styles.tierDot, { backgroundColor: data.tierColor }]} />
            <Text maxFontSizeMultiplier={FS} style={styles.tierText}>{data.tierLabel}</Text>
          </View>
        </View>
        <View>
          <Text maxFontSizeMultiplier={FS} style={styles.label}>Бонусы</Text>
          <BonusValue value={data.bonus} hidden={data.bonusHidden} engraved />
          {data.expiring ? <Text maxFontSizeMultiplier={FS} style={styles.expiring} numberOfLines={1}>{data.expiring}</Text> : null}
        </View>
        <Text maxFontSizeMultiplier={FS} style={[styles.nick, styles.engraved]} numberOfLines={1}>@{data.nickname || 'гость'}</Text>
      </View>
    </View>
  );
}

// ── Голографическая фольга на тёмно-фиолетовом ─────────────────────────────────
export function FoilFace({ data, tx, ty, width }: FaceProps) {
  const foil = useAnimatedStyle(() => {
    const w = width.get();
    const motion = Math.max(Math.abs(tx.get()), Math.abs(ty.get()));
    return {
      width: w * 3,
      opacity: 0.22 + motion * 0.3,
      transform: [{ translateX: -w + tx.get() * w * 0.9 }, { translateY: ty.get() * 24 }],
    };
  });
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, styles.foilBase]} />
      <Animated.View style={[styles.foil, foil]} />
      <Glare tx={tx} ty={ty} width={width} opacity={0.9} />
      <View style={[StyleSheet.absoluteFill, styles.edge]} />
      <View style={styles.content}>
        <View style={styles.row}>
          <Text maxFontSizeMultiplier={FS} style={styles.brand}>TITAN</Text>
          <View style={styles.tierFilled}>
            <Text maxFontSizeMultiplier={FS} style={styles.tierText}>{data.tierLabel}</Text>
          </View>
        </View>
        <View>
          <Text maxFontSizeMultiplier={FS} style={styles.label}>Бонусы</Text>
          <BonusValue value={data.bonus} hidden={data.bonusHidden} />
          {data.expiring ? <Text maxFontSizeMultiplier={FS} style={styles.expiring} numberOfLines={1}>{data.expiring}</Text> : null}
        </View>
        <Text maxFontSizeMultiplier={FS} style={styles.nick} numberOfLines={1}>@{data.nickname || 'гость'}</Text>
      </View>
    </View>
  );
}

// ── Пасс Apple Wallet: шапка, полоса с бонусами, поля ──────────────────────────
export function PassFace({ data, tx, ty, width }: FaceProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.passBase]}>
      <Glare tx={tx} ty={ty} width={width} opacity={0.8} />
      <View style={styles.passHeader}>
        <Text maxFontSizeMultiplier={FS} style={styles.brand}>TITAN</Text>
        <View style={styles.passField}>
          <Text maxFontSizeMultiplier={FS} style={[styles.label, styles.right]}>Статус</Text>
          <Text maxFontSizeMultiplier={FS} style={[styles.passValue, styles.right]} numberOfLines={1}>{data.tierLabel}</Text>
        </View>
      </View>
      <View style={styles.passStrip}>
        {data.bonusHidden ? (
          <Text maxFontSizeMultiplier={FS} style={styles.hidden}>{HIDDEN_BONUS}</Text>
        ) : (
          <View style={styles.stripRow}>
            <RollingNumber value={data.bonus} format={fmtBonus} style={styles.passBonus} maxFontSizeMultiplier={FS} />
            <Text maxFontSizeMultiplier={FS} style={styles.stripUnit}>бонусов</Text>
          </View>
        )}
      </View>
      <View style={styles.passFields}>
        <View style={styles.passField}>
          <Text maxFontSizeMultiplier={FS} style={styles.label}>Депозит</Text>
          <Text maxFontSizeMultiplier={FS} style={styles.passValue} numberOfLines={1}>{money(data.deposit ?? 0)}</Text>
        </View>
        <View style={styles.passField}>
          <Text maxFontSizeMultiplier={FS} style={styles.label}>Визитов</Text>
          <Text maxFontSizeMultiplier={FS} style={styles.passValue}>{data.visits ?? 0}</Text>
        </View>
        <View style={[styles.passField, styles.passNick]}>
          <Text maxFontSizeMultiplier={FS} style={[styles.label, styles.right]}>Ник</Text>
          <Text maxFontSizeMultiplier={FS} style={[styles.passValue, styles.right]} numberOfLines={1}>@{data.nickname || 'гость'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, padding: 20, justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  right: { textAlign: 'right' },
  edge: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  glare: {
    position: 'absolute', top: 0, left: 0, borderRadius: 9999,
    experimental_backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0) 62%)',
  },
  brand: { color: '#f1eff6', fontSize: 17, fontWeight: '700', letterSpacing: 6 },
  engraved: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: -1 }, textShadowRadius: 0 },
  label: { color: 'rgba(255,255,255,0.62)', fontSize: 11, fontWeight: '600', letterSpacing: 1.4, textTransform: 'uppercase' },
  bonus: { color: '#ffffff', fontSize: 36, fontWeight: '700', letterSpacing: -0.8, marginTop: 2 },
  hidden: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600', marginTop: 4 },
  expiring: { color: '#fcd34d', fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  nick: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600', letterSpacing: 0.3 },
  tierOutline: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  tierFilled: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  tierDot: { width: 7, height: 7, borderRadius: 4 },
  tierText: { color: '#f4f2f8', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },

  metalBase: { experimental_backgroundImage: 'linear-gradient(140deg, #4b4a52 0%, #2d2c32 34%, #1c1b20 60%, #3b3a41 100%)' },
  // Тонкие горизонтальные «шлифовки» металла.
  metalBrush: {
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(0,0,0,0.05) 6%, rgba(255,255,255,0.025) 12%, rgba(0,0,0,0.04) 19%, ' +
      'rgba(255,255,255,0.03) 27%, rgba(0,0,0,0.05) 34%, rgba(255,255,255,0.02) 42%, rgba(0,0,0,0.04) 51%, rgba(255,255,255,0.03) 60%, ' +
      'rgba(0,0,0,0.05) 68%, rgba(255,255,255,0.025) 77%, rgba(0,0,0,0.04) 86%, rgba(255,255,255,0.03) 94%, rgba(0,0,0,0.05) 100%)',
  },
  metalBand: {
    position: 'absolute', top: -20, bottom: -20, left: 0,
    experimental_backgroundImage:
      'linear-gradient(100deg, rgba(255,255,255,0) 36%, rgba(255,255,255,0.12) 46%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.12) 54%, rgba(255,255,255,0) 64%)',
  },

  foilBase: { experimental_backgroundImage: 'linear-gradient(140deg, #2d1555 0%, #170b2e 52%, #27104a 100%)' },
  foil: {
    position: 'absolute', top: -30, bottom: -30, left: 0, mixBlendMode: 'color-dodge',
    experimental_backgroundImage:
      'linear-gradient(110deg, #ff6ad5 0%, #c774e8 11%, #ad8cff 22%, #8795e8 33%, #94d0ff 44%, #6ef0c8 55%, #ffe27a 66%, #ff9a8b 77%, #c774e8 88%, #ff6ad5 100%)',
  },

  passBase: { backgroundColor: '#5b21b6' },
  passHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  passStrip: { experimental_backgroundImage: 'linear-gradient(90deg, #45198a 0%, #5321a8 100%)', paddingHorizontal: 18, paddingVertical: 10 },
  stripRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  passBonus: { color: '#ffffff', fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  stripUnit: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
  passFields: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
  passField: { gap: 2 },
  passNick: { flex: 1, alignItems: 'flex-end' },
  passValue: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
