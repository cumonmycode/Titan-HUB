import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text, TextInput } from '@/components/text';
import { ClearButton } from '@/components/clear-button';
import { AmountKeypad, GlassCard, GlassChip, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import { type EveningKey, invalidateShift, OPEN_SHIFT_EVENING_KEYS, parseAmount, useEveningTypes, useLastCashEnd } from '@/lib/shift-api';
import { useTextLayout } from '@/lib/text-scale';
import { colors, radius, space, type } from '@/lib/theme';

const layout = LinearTransition.springify().damping(22).stiffness(220);

/** Значки вечеров; цвет берём из справочника клуба. */
const EVENING_ICON: Record<string, SFSymbol> = {
  sport_mafia: 'trophy.fill',
  city_mafia: 'building.2.fill',
  kids_mafia: 'figure.2.and.child.holdinghands',
  board_games: 'dice.fill',
  none: 'moon.stars',
};
const NONE_COLOR = '#94A3B8';
/** Цвета строкой: к ним дописывается прозрачность (PlatformColor так не умеет). */
const TONE = { green: '#34C759', orange: '#FF9500', red: '#FF3B30', gray: '#8E8E93', accent: '#8B5CF6' } as const;

/** Частые причины расхождения — в одно касание, как быстрые ответы в чате. */
const SHORTAGE_REASONS = ['Инкассация', 'Выдали из кассы', 'Ошибка при закрытии'];
const SURPLUS_REASONS = ['Добавили размен', 'Ошибка при закрытии'];

/** «12500,5» → «12 500,5»: во время ввода показываем ровно то, что набрано, но с разрядами. */
function formatTyped(text: string): string {
  const [whole = '', fraction] = text.split(',');
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction !== undefined ? `${grouped},${fraction}` : grouped;
}

const toTyped = (value: number) => String(value).replace('.', ',');

/**
 * Открытие смены. Главный путь — два касания: сумма уже подставлена с конца прошлой смены,
 * остаётся выбрать вечер и нажать «Открыть смену». Если наличных другое количество —
 * «Пересчитать» открывает клавиатуру как в Apple Pay, а расхождение сразу объясняется и
 * просит причину (сервер проведёт его внесением или изъятием).
 */
export default function OpenShift() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lastCashEnd = useLastCashEnd();
  const eveningTypes = useEveningTypes();
  const [typed, setTyped] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [evening, setEvening] = useState<EveningKey>('none');

  const loading = lastCashEnd.isLoading;
  const expected = lastCashEnd.data ?? null;
  const prefill = lastCashEnd.isSuccess ? toTyped(expected ?? 0) : '';
  const cashText = typed ?? prefill;
  const cash = parseAmount(cashText);

  // Сервер сравнивает строго (`!== 0`): копеечный шум float не должен требовать причину.
  const matches = expected !== null && cash !== null && Math.abs(cash - expected) < 0.005;
  const needsReason = expected !== null && cash !== null && !matches;
  const diff = needsReason ? Math.round((cash - expected) * 100) / 100 : 0;
  const canSubmit = !loading && cash !== null && (!needsReason || reason.trim().length > 0);

  // Сервер принимает только эти ключи вечера; свои типы из справочника пока не отправить.
  const evenings = (eveningTypes.data ?? []).filter(
    (t) => (OPEN_SHIFT_EVENING_KEYS as readonly string[]).includes(t.key) && t.key !== 'none',
  );

  const open = useMutation({
    mutationFn: () =>
      api.post('/shifts/open', {
        cashStart: matches ? expected : cash,
        eveningType: evening,
        adjustmentReason: needsReason ? reason.trim() : undefined,
      }),
    onSuccess: () => {
      haptic.success();
      invalidateShift();
      router.back();
    },
    onError: () => haptic.error(),
  });

  const pickEvening = (key: EveningKey) => {
    haptic.selection();
    setEvening(key);
    setEditing(false);
  };

  const status: { icon: SFSymbol; text: string; color: string } =
    expected === null
      ? { icon: 'hand.raised', text: 'Пересчитайте наличные в кассе', color: TONE.gray }
      : matches
        ? { icon: 'checkmark.circle.fill', text: 'Как в конце прошлой смены', color: TONE.green }
        : diff < 0
          ? { icon: 'arrow.down.circle.fill', text: `Недостача ${formatMoney(-diff, { kopecks: 'auto' })}`, color: TONE.red }
          : { icon: 'arrow.up.circle.fill', text: `Излишек ${formatMoney(diff, { kopecks: 'auto' })}`, color: TONE.orange };

  const errorText = open.error ? (open.error.message === 'Shift already open' ? 'Смена уже открыта' : open.error.message) : null;

  return (
    // collapsable={false}: иначе обёртка схлопывается, и react-native-screens растягивает список
    // до низа шторки, под панель с кнопкой (см. app/pay/index.tsx). Первая в цепочке — шапка.
    <KeyboardAvoidingView behavior="padding" style={styles.screen} collapsable={false}>
      <View style={styles.header}>
        <SheetHeader title="Открыть смену" onClose={() => router.back()} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS}
        showsVerticalScrollIndicator={false}>
        {/* ——— Наличные ——— */}
        <Animated.View layout={layout}>
          <GlassCard style={styles.cashCard}>
            <Text style={[type.footnote, styles.caption]}>НАЛИЧНЫЕ В КАССЕ</Text>
            {loading ? (
              <ActivityIndicator style={styles.cashLoading} />
            ) : (
              <Pressable
                onPress={() => {
                  haptic.selection();
                  setEditing((on) => !on);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Наличные в кассе ${formatMoney(cash ?? 0, { kopecks: 'auto' })}. Изменить`}>
                <View style={styles.amountRow}>
                  <RollingText text={formatTyped(cashText)} style={[styles.amount, type.amount, !cashText && styles.placeholder]} />
                  <Text style={[styles.currency, type.amount]}>₽</Text>
                </View>
              </Pressable>
            )}

            {!loading && (
              <Animated.View key={status.text} entering={FadeIn.duration(160)} style={[styles.status, { backgroundColor: `${status.color}1F` }]}>
                <SymbolView name={status.icon} size={15} tintColor={status.color} />
                <Text style={[type.subhead, styles.statusText, { color: status.color }]}>{status.text}</Text>
              </Animated.View>
            )}

            {!loading && expected !== null && !matches && (
              <Text style={[type.footnote, styles.caption]}>{`С прошлой смены осталось ${formatMoney(expected, { kopecks: 'auto' })}`}</Text>
            )}

            {!loading && !editing && (
              <View style={styles.cashActions}>
                <GlassChip label="Пересчитать" icon="pencil" active={false} onPress={() => { haptic.selection(); setEditing(true); }} />
              </View>
            )}

            {editing && (
              <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.keypadWrap}>
                <AmountKeypad value={cashText} onChange={setTyped} />
                <View style={styles.cashActions}>
                  {expected !== null && !matches && (
                    <GlassChip
                      label={`Вернуть ${formatMoney(expected, { kopecks: 'auto' })}`}
                      icon="arrow.uturn.backward"
                      active={false}
                      onPress={() => {
                        haptic.selection();
                        setTyped(null);
                      }}
                    />
                  )}
                  <GlassChip label="Готово" icon="checkmark" active onPress={() => { haptic.selection(); setEditing(false); }} />
                </View>
              </Animated.View>
            )}
          </GlassCard>
        </Animated.View>

        {/* ——— Причина расхождения ——— */}
        {needsReason && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} layout={layout}>
            <GlassCard tint={diff < 0 ? 'rgba(255,59,48,0.12)' : 'rgba(255,149,0,0.12)'} style={styles.reasonCard}>
              <Text style={[type.headline, sheetStyles.label]}>{diff < 0 ? 'Почему меньше?' : 'Откуда больше?'}</Text>
              <Text style={[type.footnote, sheetStyles.secondary]}>
                {diff < 0
                  ? `Проведём изъятие ${formatMoney(-diff, { kopecks: 'auto' })} из кассы с этой причиной.`
                  : `Проведём внесение ${formatMoney(diff, { kopecks: 'auto' })} в кассу с этой причиной.`}
              </Text>
              <View style={styles.reasonChips}>
                {(diff < 0 ? SHORTAGE_REASONS : SURPLUS_REASONS).map((r) => (
                  <GlassChip
                    key={r}
                    label={r}
                    active={reason === r}
                    onPress={() => {
                      haptic.selection();
                      setReason(reason === r ? '' : r);
                    }}
                  />
                ))}
              </View>
              <View style={styles.reasonField}>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Или своими словами"
                  placeholderTextColor={colors.tertiaryLabel}
                  selectionColor={colors.accent}
                  autoCapitalize="sentences"
                  style={[type.body, styles.reasonInput]}
                  clearButtonMode="while-editing"
                  onFocus={() => setEditing(false)}
                />
                <ClearButton visible={reason.length > 0} onPress={() => setReason('')} />
              </View>
            </GlassCard>
          </Animated.View>
        )}

        {/* ——— Вечер ——— */}
        <Animated.View layout={layout} style={styles.section}>
          <Text style={[type.footnote, sheetStyles.sectionTitle]}>КАКОЙ СЕГОДНЯ ВЕЧЕР</Text>
          <View style={styles.grid}>
            {evenings.map((t) => (
              <EveningTile
                key={t.key}
                label={t.label}
                color={t.color || TONE.accent}
                icon={EVENING_ICON[t.key] ?? 'sparkles'}
                active={evening === t.key}
                onPress={() => pickEvening(t.key as EveningKey)}
              />
            ))}
            <EveningTile label="Без вечера" color={NONE_COLOR} icon={EVENING_ICON.none!} active={evening === 'none'} onPress={() => pickEvening('none')} wide />
          </View>
          {eveningTypes.isLoading && <ActivityIndicator />}
        </Animated.View>

        {errorText && (
          <Animated.View entering={FadeIn} style={styles.error}>
            <SymbolView name="exclamationmark.triangle.fill" size={15} tintColor={colors.red} />
            <Text style={[type.subhead, styles.errorText]}>{errorText}</Text>
          </Animated.View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <PrimaryButton
          title={open.isPending ? 'Открываем…' : 'Открыть смену'}
          icon="sunrise.fill"
          busy={open.isPending}
          disabled={!canSubmit}
          onPress={() => {
            haptic.medium();
            open.mutate();
          }}
        />
        {needsReason && !reason.trim() && <Text style={[type.footnote, styles.footerHint]}>Выберите причину расхождения</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

function EveningTile({
  label,
  color,
  icon,
  active,
  onPress,
  wide,
}: {
  label: string;
  color: string;
  icon: SFSymbol;
  active: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  // Очень крупный текст: плитки вечеров по одной в ряд — в половину ширины название рвалось.
  const { stacked } = useTextLayout();
  return (
    <Pressable
      onPress={onPress}
      style={wide || stacked ? styles.tileWide : styles.tileCell}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}>
      <GlassCard interactive tint={active ? `${color}33` : undefined} style={[styles.tile, active && { borderColor: color }]}>
        <View style={[styles.tileIcon, { backgroundColor: active ? color : `${color}26` }]}>
          <SymbolView name={icon} size={17} tintColor={active ? 'white' : color} />
        </View>
        <Text style={[type.subhead, styles.tileText, active && styles.tileTextActive]} numberOfLines={2}>
          {label}
        </Text>
        {active && <SymbolView name="checkmark.circle.fill" size={20} tintColor={color} />}
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.lg },
  caption: { color: colors.secondaryLabel, textAlign: 'center', letterSpacing: 0.4 },

  cashCard: { padding: space.lg, gap: space.md, alignItems: 'stretch' },
  cashLoading: { height: 64 },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6 },
  amount: { fontSize: 52, lineHeight: 62, color: colors.label },
  placeholder: { color: colors.tertiaryLabel },
  currency: { fontSize: 26, lineHeight: 62, color: colors.secondaryLabel },
  status: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusText: { fontWeight: '600' },
  cashActions: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: space.sm },
  keypadWrap: { gap: space.md, paddingTop: space.xs },

  reasonCard: { padding: space.lg, gap: space.sm },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  reasonField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    backgroundColor: colors.fill,
    marginTop: space.xs,
  },
  reasonInput: { flex: 1, color: colors.label, paddingVertical: space.sm },

  section: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm },
  tileCell: { width: '48.8%' },
  tileWide: { width: '100%' },
  tile: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tileIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, color: colors.label, fontWeight: '500' },
  tileTextActive: { fontWeight: '700' },

  error: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  errorText: { color: colors.red },

  footer: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.xs },
  footerHint: { color: colors.secondaryLabel, textAlign: 'center' },
});
