import { SymbolView } from 'expo-symbols';
import { useEffect, useEffectEvent, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { formatMoney } from '@/lib/format';
import { colors, space, type } from '@/lib/theme';

/** Экран «Оплачено» поверх шторки: галочка, сумма и сдача; сам закрывается через пару секунд. */
export function PaymentSuccess({
  title,
  amount,
  change,
  onDone,
}: {
  title: string;
  amount: number | null;
  change: number;
  onDone: () => void;
}) {
  const done = useRef(false);

  const close = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  const onTimeout = useEffectEvent(close);

  useEffect(() => {
    // Со сдачей кассиру нужно время её отсчитать — держим экран дольше.
    const timer = setTimeout(onTimeout, change > 0 ? 3200 : 1900);
    return () => clearTimeout(timer);
  }, [change]);

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.overlay}>
      <Pressable style={styles.center} onPress={close} accessibilityRole="button" accessibilityLabel={`${title}. Закрыть`}>
        <Animated.View entering={ZoomIn.springify().damping(13).stiffness(170)}>
          <SymbolView name="checkmark.circle.fill" size={108} tintColor={colors.green} animationSpec={{ effect: { type: 'bounce' } }} />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120).duration(260)} style={styles.texts}>
          <Text style={[type.title2, styles.label]}>{title}</Text>
          {amount !== null && <Text style={[styles.amount, type.amount]}>{formatMoney(amount, { kopecks: 'auto' })}</Text>}
          {change > 0 && (
            <GlassView tintColor="rgba(52,199,89,0.22)" style={styles.change}>
              <Text style={[type.headline, styles.changeLabel]}>Сдача</Text>
              <Text style={[type.title2, type.amount, styles.changeAmount]}>{formatMoney(change, { kopecks: 'auto' })}</Text>
            </GlassView>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.groupedBackground, zIndex: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xxl },
  texts: { alignItems: 'center', gap: space.xs },
  label: { color: colors.label },
  amount: { fontSize: 44, lineHeight: 52, color: colors.label },
  change: {
    marginTop: space.md,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: 22,
    borderCurve: 'continuous',
  },
  changeLabel: { color: colors.secondaryLabel },
  changeAmount: { color: colors.green },
});
