import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, type SharedValue, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SiteMock } from '@/components/site/site-mock';
import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { saveSite, siteUrlOf, useSiteConfig, useSiteDomain } from '@/lib/site-api';
import { SITE_LOOKS, lookOf, type SiteLookId } from '@/lib/site-looks';
import { colors, space, type } from '@/lib/theme';

const GAP = 14;
const SIDE_PEEK = 56;
const MAX_ITEM = 270;
/** Насколько соседние превью подтянуты к центру (доля ширины) — выглядывают из-за краёв. */
const NEIGHBOR_PULL = 0.08;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Оформление сайта — как выбор вида карты в My Titan: лента живых превью первого
 * экрана сайта, в центре — крупно, соседние меньше и развёрнуты в 3D. Название и
 * кнопка меняются прямо по ходу прокрутки; «Включить» сохраняет сразу, сайт
 * обновляется в течение минуты. «Посмотреть» открывает превью, не меняя сайт.
 */
export default function SiteLookScreen() {
  const config = useSiteConfig();
  const domain = useSiteDomain();
  const { width: screen } = useWindowDimensions();
  const saved = lookOf(config.data?.holiday).id;
  const [picked, setPicked] = useState<SiteLookId | null>(null);
  const active = picked ?? saved;
  const [initial] = useState(() => Math.max(0, SITE_LOOKS.findIndex((l) => l.id === saved)));
  const [index, setIndex] = useState(initial);
  const [busy, setBusy] = useState(false);
  const item = Math.min(screen - SIDE_PEEK * 2, MAX_ITEM);
  const step = item + GAP;
  const scrollX = useSharedValue(initial * step);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.set(e.contentOffset.x);
  });
  const last = SITE_LOOKS.length - 1;
  const onIndex = (next: number) => {
    haptic.selection();
    setIndex(next);
  };
  useAnimatedReaction(
    () => Math.max(0, Math.min(last, Math.round(scrollX.get() / step))),
    (next, prev) => {
      if (prev !== null && next !== prev) scheduleOnRN(onIndex, next);
    },
  );

  const look = SITE_LOOKS[index] ?? SITE_LOOKS[0]!;
  const isActive = look.id === active;
  const enable = () => {
    if (isActive || busy) return;
    haptic.medium();
    setBusy(true);
    setPicked(look.id);
    saveSite({ holiday: look.id === 'none' ? null : look.id })
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setPicked(null);
        Alert.alert('Оформление не сменилось', errorText(error));
      })
      .finally(() => setBusy(false));
  };
  const preview = () => {
    haptic.light();
    void WebBrowser.openBrowserAsync(`${siteUrlOf(domain.data)}/preview/${look.id}`);
  };

  return (
    <>
      <Stack.Title>Оформление</Stack.Title>
      <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {/* Несплющиваемая обёртка: иначе iOS растянула бы горизонтальную ленту. */}
        <View collapsable={false}>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={step}
            decelerationRate="fast"
            contentOffset={{ x: initial * step, y: 0 }}
            contentContainerStyle={{ paddingHorizontal: (screen - item) / 2, gap: GAP }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            style={styles.carousel}>
            {SITE_LOOKS.map((l, i) => (
              <CarouselItem key={l.id} i={i} step={step} width={item} scrollX={scrollX}>
                <SiteMock look={l} width={item} />
                {l.id === active && (
                  <View style={styles.badge}>
                    <SymbolView name="checkmark" size={11} weight="bold" tintColor="white" />
                    <Text style={[type.caption1, styles.badgeText]}>На сайте</Text>
                  </View>
                )}
              </CarouselItem>
            ))}
          </Animated.ScrollView>
        </View>

        <View style={styles.dots}>
          {SITE_LOOKS.map((l, i) => <View key={l.id} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
        <Text style={[type.title2, styles.title]}>{look.title}</Text>
        <Text style={[type.callout, styles.hint]}>{look.hint}</Text>

        <View style={styles.actions}>
          <Pressable
            onPress={enable}
            disabled={isActive || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: isActive || busy, busy }}
            style={({ pressed }) => [styles.button, isActive ? styles.buttonDone : styles.buttonPrimary, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color="white" /> : <SymbolView name={isActive ? 'checkmark.circle.fill' : 'paintbrush.fill'} size={16} weight="semibold" tintColor={isActive ? colors.green : 'white'} />}
            <Text style={[type.headline, isActive ? styles.doneText : styles.onAccent]}>
              {isActive ? 'Сейчас на сайте' : look.id === 'none' ? 'Вернуть обычный вид' : `Включить «${look.title}»`}
            </Text>
          </Pressable>
          <Pressable onPress={preview} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.buttonGhost, pressed && styles.pressed]}>
            <SymbolView name="eye" size={16} weight="semibold" tintColor={colors.label} />
            <Text style={[type.headline, styles.label]}>Посмотреть на сайте</Text>
          </Pressable>
          <Text style={[type.footnote, styles.note]}>
            Каркас и стекло сайта не меняются — добавляются частицы, декорации, оттенок и поздравление. Сайт обновится в течение минуты.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

/** Превью в ленте: в центре — крупно и ярко, по краям — меньше, тусклее и развёрнуто к центру. */
function CarouselItem({ i, step, width, scrollX, children }: { i: number; step: number; width: number; scrollX: SharedValue<number>; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const pos = (scrollX.get() - i * step) / step;
    return {
      opacity: interpolate(Math.abs(pos), [0, 1], [1, 0.5], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(pos, [-1, 0, 1], [-width * NEIGHBOR_PULL, 0, width * NEIGHBOR_PULL], Extrapolation.CLAMP) },
        { perspective: 900 },
        { scale: interpolate(Math.abs(pos), [0, 1], [1, 0.86], Extrapolation.CLAMP) },
        { rotateY: `${interpolate(pos, [-1, 0, 1], [-16, 0, 16], Extrapolation.CLAMP)}deg` },
      ],
    };
  });
  return <Animated.View style={[{ width }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { paddingBottom: space.xxxl },
  carousel: { flexGrow: 0, paddingTop: space.lg, paddingBottom: space.xl },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(48,209,88,0.92)',
  },
  badgeText: { color: 'white', fontWeight: '700' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.fill },
  dotOn: { width: 18, backgroundColor: colors.accent },
  title: { color: colors.label, textAlign: 'center', marginTop: space.xl },
  hint: { color: colors.secondaryLabel, textAlign: 'center', marginTop: space.xs, paddingHorizontal: space.xl },
  actions: { gap: space.sm, paddingHorizontal: space.xl, marginTop: space.xxl },
  button: { minHeight: 52, borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonDone: { backgroundColor: colors.fill },
  buttonGhost: { backgroundColor: colors.fill },
  onAccent: { color: 'white' },
  doneText: { color: colors.label },
  label: { color: colors.label },
  note: { color: colors.secondaryLabel, textAlign: 'center', marginTop: space.sm },
  pressed: { opacity: 0.7 },
});
