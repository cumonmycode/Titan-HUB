// Выбор вида карты: горизонтальная лента с «живой» картой в центре (наклон по гироскопу),
// соседние карты меньше, приглушены и развёрнуты в 3D. «Выбрать» — под лентой.
import { useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, type SharedValue, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { ClubCard, type ClubCardData } from '@/components/club-card';
import { GlassButton } from '@/components/glass';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { CARD_STYLES, useCardStyle } from '@/lib/card-style';
import { haptic } from '@/lib/haptics';
import { useWallet } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

const GAP = 14;
const SIDE_PEEK = 44;
const MAX_ITEM = 360;
/** Насколько соседние карты подтянуты к центру (доля ширины) — чтобы выглядывали из-за краёв. */
const NEIGHBOR_PULL = 0.08;

export default function CardStyleScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet('/profile');
  const { width: screen } = useWindowDimensions();
  const { data: w } = useWallet();
  const current = useCardStyle((s) => s.style);
  const setStyle = useCardStyle((s) => s.setStyle);
  const [initial] = useState(() => Math.max(0, CARD_STYLES.findIndex((c) => c.key === current)));
  const [index, setIndex] = useState(initial);
  const item = Math.min(screen - SIDE_PEEK * 2, MAX_ITEM);
  const step = item + GAP;
  const scrollX = useSharedValue(initial * step);

  const onScroll = useAnimatedScrollHandler((e) => { scrollX.set(e.contentOffset.x); });
  const last = CARD_STYLES.length - 1;
  const onIndex = (next: number) => { haptic.select(); setIndex(next); };
  // Название и кнопка меняются прямо по ходу прокрутки — как щелчки колеса выбора.
  useAnimatedReaction(
    () => Math.max(0, Math.min(last, Math.round(scrollX.get() / step))),
    (next, prev) => { if (prev !== null && next !== prev) scheduleOnRN(onIndex, next); },
  );

  const data: ClubCardData = {
    nickname: w?.profile.nickname ?? 'titan',
    tierLabel: w?.tier.label ?? 'Резидент',
    tierColor: w?.tier.color ?? colors.violet,
    bonus: w?.bonus ?? 1240,
    bonusHidden: w?.bonusHidden ?? false,
  };
  const option = CARD_STYLES[index] ?? CARD_STYLES[0]!;
  const selected = option.key === current;

  return (
    <View style={styles.root}>
      <SheetHeader title="Вид карты" onClose={close} />
      {/* Несплющиваемая обёртка: шторка iOS иначе растянула бы горизонтальную ленту. */}
      <View collapsable={false} style={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          contentOffset={{ x: initial * step, y: 0 }}
          contentContainerStyle={{ paddingHorizontal: (screen - item) / 2, gap: GAP }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.carousel}
        >
          {CARD_STYLES.map((c, i) => (
            <CarouselItem key={c.key} i={i} step={step} width={item} scrollX={scrollX}>
              <ClubCard data={data} variant={c.key} interactive={false} motion={i === index} />
            </CarouselItem>
          ))}
        </Animated.ScrollView>

        <View style={styles.dots}>
          {CARD_STYLES.map((c, i) => <View key={c.key} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
        <Text style={styles.title}>{option.title}</Text>
        <Text style={styles.text}>{option.text}</Text>
        <Text style={styles.hint}>Наклоните телефон — карта поймает свет</Text>

        <View style={styles.action}>
          <GlassButton
            title={selected ? 'Выбрана' : `Выбрать «${option.title}»`}
            icon={selected ? 'check' : undefined}
            variant={selected ? 'secondary' : 'primary'}
            onPress={() => {
              if (selected) { close(); return; }
              haptic.success();
              setStyle(option.key);
            }}
          />
        </View>
      </View>
    </View>
  );
}

/** Карта в ленте: в центре — крупно и ярко, по краям — меньше, тусклее и развёрнута к центру. */
function CarouselItem({ i, step, width, scrollX, children }: {
  i: number; step: number; width: number; scrollX: SharedValue<number>; children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const pos = (scrollX.get() - i * step) / step;
    return {
      opacity: interpolate(Math.abs(pos), [0, 1], [1, 0.45], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(pos, [-1, 0, 1], [-width * NEIGHBOR_PULL, 0, width * NEIGHBOR_PULL], Extrapolation.CLAMP) },
        { perspective: 900 },
        { scale: interpolate(Math.abs(pos), [0, 1], [1, 0.86], Extrapolation.CLAMP) },
        { rotateY: `${interpolate(pos, [-1, 0, 1], [-18, 0, 18], Extrapolation.CLAMP)}deg` },
      ],
    };
  });
  return <Animated.View style={[{ width }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, justifyContent: 'center' },
  carousel: { flexGrow: 0, paddingVertical: space.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { width: 18, backgroundColor: colors.violetLight },
  title: { ...StyleSheet.flatten(type.title), textAlign: 'center', marginTop: space.xl },
  text: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, textAlign: 'center', marginTop: space.xs, paddingHorizontal: space.xl },
  hint: { ...StyleSheet.flatten(type.caption), color: colors.textMuted, textAlign: 'center', marginTop: space.sm },
  action: { paddingHorizontal: space.xl, marginTop: space.xxl },
});
