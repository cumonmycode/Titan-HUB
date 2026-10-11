import { DatePicker, Host, Toggle } from '@expo/ui/swift-ui';
import { tint } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { GlassCard, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { computeRental } from '@/lib/checks';
import { formatDuration, formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { setCheckRental } from '@/lib/pos-api';
import { useCheck } from '@/lib/queries';
import { colors, space, type, useAccentHex } from '@/lib/theme';
import { useNow } from '@/lib/use-now';

/**
 * Время аренды зоны: начало и конец. Пока конец не задан, счётчик идёт до оплаты.
 * Сохраняем одним запросом по кнопке — колёса времени не шлют запрос на каждый шаг.
 */
export default function RentalSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const accent = useAccentHex();
  const check = useCheck(checkId);
  const now = useNow(30_000);
  const data = check.data;

  const initialStart = data?.spaceStartAt ? new Date(data.spaceStartAt) : new Date();
  const initialEnd = data?.spaceEndAt ? new Date(data.spaceEndAt) : null;
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const startAt = start ?? initialStart;
  const endAt = end === undefined ? initialEnd : end;
  const live = endAt === null;
  const invalid = !!endAt && endAt.getTime() <= startAt.getTime();
  const rental = computeRental(startAt.toISOString(), endAt?.toISOString() ?? null, data?.spaceHourlyRate ?? null, now);

  const save = async () => {
    if (invalid || busy) return;
    haptic.medium();
    setBusy(true);
    try {
      await setCheckRental(checkId, { spaceStartAt: startAt.toISOString(), spaceEndAt: endAt ? endAt.toISOString() : null });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Время не сохранено', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title="Время аренды" onClose={() => router.back()} />

      <GlassCard style={styles.card}>
        <Host matchContents={{ vertical: true }} style={styles.row} seedColor={accent}>
          <DatePicker
            title="Начало"
            selection={startAt}
            range={{ end: endAt ?? new Date(now + 60_000) }}
            displayedComponents={['date', 'hourAndMinute']}
            onDateChange={(date) => setStart(toMinute(date))}
          />
        </Host>
        <View style={sheetStyles.separator} />
        <Host matchContents={{ vertical: true }} style={styles.row} seedColor={accent}>
          <Toggle
            label="Идёт сейчас"
            isOn={live}
            onIsOnChange={(on) => {
              haptic.selection();
              setEnd(on ? null : toMinute(new Date(Math.max(Date.now(), startAt.getTime() + 60_000))));
            }}
            modifiers={[tint(accent)]}
          />
        </Host>
        {!live && endAt && (
          <>
            <View style={sheetStyles.separator} />
            <Host matchContents={{ vertical: true }} style={styles.row} seedColor={accent}>
              <DatePicker
                title="Конец"
                selection={endAt}
                range={{ start: new Date(startAt.getTime() + 60_000) }}
                displayedComponents={['date', 'hourAndMinute']}
                onDateChange={(date) => setEnd(toMinute(date))}
              />
            </Host>
          </>
        )}
      </GlassCard>

      <Text style={[type.footnote, styles.summary, invalid && styles.error]}>
        {invalid
          ? 'Конец аренды должен быть позже начала'
          : `${formatDuration(startAt.toISOString(), endAt?.getTime() ?? now)} · ${formatMoney(rental)}${live ? ' и дальше по начатым часам' : ''}`}
      </Text>

      <PrimaryButton title={busy ? 'Сохраняем…' : 'Сохранить'} busy={busy} disabled={invalid || data?.status !== 'open'} onPress={() => void save()} />
    </View>
  );
}

/**
 * Выбор времени меняет только часы и минуты, а секунды оставляет от прежнего значения:
 * «14:00» превращалось в 14:00:27, и ровно 3 часа аренды считались как 4. Храним время
 * аренды с точностью до минуты.
 */
function toMinute(date: Date): Date {
  const next = new Date(date);
  next.setSeconds(0, 0);
  return next;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  card: { paddingVertical: space.xs },
  row: { alignSelf: 'stretch', paddingHorizontal: space.lg, paddingVertical: space.sm },
  summary: { color: colors.secondaryLabel, paddingHorizontal: space.xs, fontVariant: ['tabular-nums'] },
  error: { color: colors.red },
});
