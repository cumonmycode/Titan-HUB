import { HStack, Picker, ProgressView, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, lineLimit, monospacedDigit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';

import { Avatar } from '@/components/new-check-parts';
import { primary, secondary } from '@/components/native-form';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { analyticsErrorText, MORE_PRESETS, QUICK_PRESETS, useAnalyticsPeriodStore, type ResolvedPeriod } from '@/lib/analytics-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { colors } from '@/lib/theme';

/**
 * Общие части нативной аналитики: выбор периода (сегменты + меню в шапке), плитки
 * показателей, строки легенды графиков, строки рейтингов. Все отчёты собраны из них —
 * один язык и один период на весь раздел.
 */

export const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
export const signed = (delta: number) => `${delta > 0 ? '+' : '−'}${Math.abs(delta)}%`;

/** Меню календаря в шапке: остальные периоды с отметкой и «Выбрать даты…». Дети — другие кнопки шапки. */
export function PeriodMenu({ period, children }: { period: ResolvedPeriod; children?: ReactNode }) {
  const router = useRouter();
  const setPreset = useAnalyticsPeriodStore((s) => s.setPreset);
  return (
    <Stack.Toolbar placement="right">
      <ToolbarMenu icon="calendar" title="Период" accessibilityLabel="Период">
        {MORE_PRESETS.map((preset) => (
          <ToolbarMenuAction key={preset.key} isOn={period.preset === preset.key} onPress={() => setPreset(preset.key)}>
            {preset.label}
          </ToolbarMenuAction>
        ))}
        <ToolbarMenuAction icon="calendar.badge.clock" isOn={period.preset === 'custom'} onPress={() => router.push('/analytics/period')}>
          Выбрать даты…
        </ToolbarMenuAction>
      </ToolbarMenu>
      {children}
    </Stack.Toolbar>
  );
}

export function periodCaption(period: ResolvedPeriod) {
  if (period.days === 1) return period.label;
  return `${period.label} · ${period.days} ${plural(period.days, ['день', 'дня', 'дней'])}`;
}

/** Сегодня, вчера, эта неделя, этот месяц — сегментами; остальное — в календаре шапки. Подпись — выбранные даты. */
export function PeriodSection({ period }: { period: ResolvedPeriod }) {
  const setPreset = useAnalyticsPeriodStore((s) => s.setPreset);
  return (
    <Section footer={<Text>{periodCaption(period)}</Text>}>
      <Picker
        selection={QUICK_PRESETS.some((q) => q.key === period.preset) ? period.preset : null}
        onSelectionChange={(value) => {
          haptic.selection();
          setPreset(value as (typeof QUICK_PRESETS)[number]['key']);
        }}
        modifiers={[pickerStyle('segmented')]}>
        {QUICK_PRESETS.map((q) => (
          <Text key={q.key} modifiers={[tag(q.key)]}>
            {q.label}
          </Text>
        ))}
      </Picker>
    </Section>
  );
}

/** Загрузка или ошибка отчёта — строкой в своей секции. */
export function StateSection({ error }: { error: unknown }) {
  return <Section>{error ? <Text modifiers={[secondary]}>{analyticsErrorText(error)}</Text> : <ProgressView />}</Section>;
}

/** Плитка показателя: подпись, крупное значение, изменение к прошлому периоду или пояснение. */
export function Tile({ label, value, delta, invert, caption }: { label: string; value: string; delta?: number; invert?: boolean; caption?: string }) {
  const good = delta === undefined || delta === 0 ? null : invert ? delta < 0 : delta > 0;
  return (
    <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: 10_000, alignment: 'leading' })]}>
      <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{label}</Text>
      <Text modifiers={[font({ textStyle: 'title3', weight: 'semibold', design: 'rounded' }), primary, monospacedDigit(), lineLimit(1)]}>{value}</Text>
      {delta !== undefined && delta !== 0 ? (
        <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(good ? colors.green : colors.red)]}>{signed(delta)}</Text>
      ) : caption ? (
        <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{caption}</Text>
      ) : null}
    </VStack>
  );
}

/** Строка легенды: цветная точка, подпись, доля и сумма. */
export function LegendRow({ color, label, value, percent, caption }: { color: ColorValue; label: string; value: string; percent?: number; caption?: string }) {
  return (
    <HStack spacing={10}>
      <Text modifiers={[foregroundStyle(color), font({ size: 12 })]}>●</Text>
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[primary, lineLimit(1)]}>{label}</Text>
        {caption ? <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{caption}</Text> : null}
      </VStack>
      <Spacer />
      {percent !== undefined ? <Text modifiers={[secondary, monospacedDigit()]}>{`${percent}%`}</Text> : null}
      <Text modifiers={[primary, monospacedDigit(), lineLimit(1), frame({ minWidth: 90, alignment: 'trailing' })]}>{value}</Text>
    </HStack>
  );
}

/** Строка рейтинга: место, (аватар), имя с пояснением и сумма справа. */
export function RankRow({ rank, name, caption, value, photo }: { rank?: number; name: string; caption?: string; value: string; photo?: { name: string; url?: string | null } }) {
  return (
    <HStack spacing={10}>
      {rank !== undefined ? <Text modifiers={[secondary, monospacedDigit(), frame({ width: 20, alignment: 'leading' })]}>{String(rank)}</Text> : null}
      {photo ? (
        <RNHostView matchContents>
          <Avatar name={photo.name} photoUrl={photo.url} size={34} />
        </RNHostView>
      ) : null}
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[primary, lineLimit(1)]}>{name}</Text>
        {caption ? <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{caption}</Text> : null}
      </VStack>
      <Spacer />
      <Text modifiers={[primary, monospacedDigit(), lineLimit(1)]}>{value}</Text>
    </HStack>
  );
}
