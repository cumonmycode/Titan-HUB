import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { Avatar } from '@/components/new-check-parts';
import { formatMoney } from '@/lib/format';
import { colors, radius, space, type } from '@/lib/theme';

/** Гость зовёт персонал — стекло карточки чуть окрашивается тёплым. */
const ATTENTION_TINT = 'rgba(255,149,0,0.22)';

export type CheckCardModel = {
  id: string;
  title: string;
  /** Фото привязанного игрока; у гостя без профиля — инициалы. */
  photoUrl: string | null;
  subtitle: string | null;
  lines: string[];
  moreCount: number;
  total: number;
  openedLabel: string;
  /** Долгое пребывание (8+ часов) — таймер подсвечивается. */
  longStay: boolean;
  hasRental: boolean;
  /** Гость в кабинке зовёт персонал, просит счёт, заказал или написал. */
  attention: boolean;
};

/**
 * Карточка открытого чека в сетке кассы — Liquid Glass. Стекло интерактивное: отклик на
 * касание (подъём и блик под пальцем) рисует сама система. Остальные props (onPress, ref
 * от Link) пробрасываются в Pressable — так работают `<Link asChild>`, предпросмотр и зум.
 * `glassKey` — смена значения заново применяет стекло (после зум-перехода, см. components/glass).
 */
export function CheckCard({ model, glassKey, compact, ...pressable }: { model: CheckCardModel; glassKey?: number; compact?: boolean } & PressableProps) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.set(
      model.attention
        ? withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.25, { duration: 700 })), -1)
        : withTiming(0, { duration: 200 }),
    );
  }, [model.attention, pulse]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Pressable
      {...pressable}
      style={styles.pressable}
      accessibilityRole="button"
      accessibilityLabel={`${model.title}, ${formatMoney(model.total)}`}>
      <GlassView
        isInteractive
        refreshKey={glassKey}
        glassEffectStyle="regular"
        tintColor={model.attention ? ATTENTION_TINT : undefined}
        style={[styles.card, compact && cardStyles.compactCard]}>
        <Animated.View pointerEvents="none" style={[styles.ring, ringStyle]} />

        <View style={[styles.header, compact && cardStyles.compactHeader]}>
          <Avatar name={model.title} photoUrl={model.photoUrl} size={compact ? 24 : 34} />
          <View style={styles.titles}>
            {/* В плотной сетке («Увеличенный» вид, крупный текст) имя — в две строки, а не «Ве…». */}
            <Text style={[type.headline, styles.label, compact && cardStyles.compactTitle]} numberOfLines={compact ? 2 : 1}>
              {model.title}
            </Text>
            {model.subtitle ? (
              <View style={styles.subtitleRow}>
                {model.hasRental && <SymbolView name="timer" size={12} tintColor={colors.accent} />}
                <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                  {model.subtitle}
                </Text>
              </View>
            ) : null}
          </View>
          {model.attention && (
            <SymbolView
              name="hand.raised.fill"
              size={18}
              tintColor={colors.orange}
              animationSpec={{ effect: { type: 'bounce' }, repeating: true }}
            />
          )}
        </View>

        <View style={styles.lines}>
          {model.lines.length === 0 ? (
            <Text style={[type.footnote, styles.tertiary]}>Чек пуст</Text>
          ) : (
            model.lines.map((line, i) => (
              <Text key={i} style={[type.footnote, styles.secondary]} numberOfLines={1}>
                {line}
              </Text>
            ))
          )}
          {model.moreCount > 0 && <Text style={[type.footnote, styles.tertiary]}>{`Ещё ${model.moreCount}`}</Text>}
        </View>

        <View style={cardStyles.footer}>
          <View style={styles.timer}>
            <SymbolView
              name={model.longStay ? 'exclamationmark.triangle.fill' : 'clock'}
              size={11}
              tintColor={model.longStay ? colors.red : colors.tertiaryLabel}
            />
            <Text style={[type.caption1, model.longStay ? styles.warn : styles.tertiary]}>{model.openedLabel}</Text>
          </View>
          <Text style={[type.title3, type.amount, styles.label, cardStyles.amount]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {formatMoney(model.total)}
          </Text>
        </View>
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Карточка растягивается до высоты ряда сетки — соседние карточки одного ряда равны.
  pressable: { flex: 1 },
  card: {
    flex: 1,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: space.lg,
    gap: space.md,
    minHeight: 172,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: colors.orange,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titles: { flex: 1, gap: 2 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  warn: { color: colors.red },
  lines: { flex: 1, gap: 2 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

/** Общее у карточек сетки кассы (чек и предчек): плотный вариант и низ карточки. */
export const cardStyles = StyleSheet.create({
  compactCard: { padding: space.md, gap: space.sm + 2, minHeight: 156 },
  compactHeader: { gap: 6 },
  // На 2 pt мельче и с аватаром 24: «Александр» целиком в строку узкой карточки, а не «Алексан / др».
  compactTitle: { fontSize: 15, lineHeight: 20 },
  // Таймер и сумма в ряд; если вместе не влезают (узкая карточка, крупный текст) — сумма
  // уходит на свою строку и прижимается вправо, а не вылезает за край карточки.
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: space.sm, rowGap: 2 },
  amount: { flexShrink: 1, marginLeft: 'auto', textAlign: 'right' },
});
