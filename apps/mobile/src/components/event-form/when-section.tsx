import { DatePicker, Host } from '@expo/ui/swift-ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormSection } from '@/components/form-parts';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { durationText } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { space, useAccentHex } from '@/lib/theme';

import { DURATION_HOURS, durationUntil, endDateFor, endLabel, isCustomDuration } from './model';
import { ChoiceChip, formStyles } from './parts';

/**
 * «Когда»: дата и начало, под ними одна длительность — быстрые часы или «Другое» со
 * временем окончания. Конец считается от начала и длительности и показан подписью
 * («до 02:00, след. день»), отдельного поля окончания нет. `minutes = null` — без
 * длительности (миникап).
 */
export function WhenSection({
  start,
  onStart,
  minutes,
  onMinutes,
}: {
  start: Date;
  onStart: (date: Date) => void;
  minutes: number | null;
  onMinutes: (minutes: number) => void;
}) {
  const accent = useAccentHex();
  // «Другое» можно выбрать и при ровных часах — тогда появляется время окончания.
  const [custom, setCustom] = useState(() => minutes !== null && isCustomDuration(minutes));
  const footer = minutes === null ? undefined : `${durationText(minutes)} · ${endLabel(start, minutes)}`;

  const pickHours = (hours: number) => {
    haptic.selection();
    setCustom(false);
    onMinutes(hours * 60);
  };

  return (
    <FormSection title="КОГДА" footer={footer}>
      <GlassCard style={formStyles.card}>
        <Host matchContents={{ vertical: true }} style={formStyles.control} seedColor={accent}>
          <DatePicker title="Начало" selection={start} displayedComponents={['date', 'hourAndMinute']} onDateChange={onStart} />
        </Host>
        {minutes !== null && custom && (
          <>
            <View style={sheetStyles.separator} />
            <Host matchContents={{ vertical: true }} style={formStyles.control} seedColor={accent}>
              <DatePicker
                title="Окончание"
                selection={endDateFor(start, minutes)}
                displayedComponents={['hourAndMinute']}
                onDateChange={(end) => onMinutes(durationUntil(start, end))}
              />
            </Host>
          </>
        )}
      </GlassCard>
      {minutes !== null && (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Длительность">
          {DURATION_HOURS.map((hours) => (
            <ChoiceChip
              key={hours}
              label={`${hours} ч`}
              accessibilityLabel={`${hours} ч`}
              active={!custom && minutes === hours * 60}
              onPress={() => pickHours(hours)}
            />
          ))}
          <ChoiceChip
            label="Другое"
            accessibilityLabel="Другая длительность: выбрать время окончания"
            active={custom}
            onPress={() => {
              haptic.selection();
              setCustom(true);
            }}
          />
        </View>
      )}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 },
});
