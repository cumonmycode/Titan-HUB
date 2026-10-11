import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { AddressField } from '@/components/address-field';
import { FormSection } from '@/components/form-parts';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { dayNumber, monthShort, timeRange, type SpaceAvailability } from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

import type { FormKind } from './model';
import { formStyles, InfoRow } from './parts';

/** Зона в списке: `free` нет — занятость ещё не проверена. */
export type ZoneOption = Pick<SpaceAvailability, 'id' | 'name' | 'hourlyRate'> & Partial<Pick<SpaceAvailability, 'free' | 'conflict'>>;

/** «занята 18:00–21:00 · Бронь: Анна»; ночное с прошлого дня — с датой. */
function busyText(conflict: NonNullable<ZoneOption['conflict']>, date: string): string {
  const day = conflict.date !== date ? `${dayNumber(conflict.date)} ${monthShort(conflict.date)}, ` : '';
  return `занята ${day}${timeRange(conflict)}${conflict.title ? ` · ${conflict.title}` : ''}`;
}

/**
 * «Где»: в клубе — зоны с занятостью на выбранное время, у выезда — адрес, у миникапа —
 * всегда TITAN. Занятую зону выбрать можно (например, чтобы потом сдвинуть время), но под
 * списком появится предупреждение: сервер такую бронь не сохранит.
 */
export function WhereSection({
  kind,
  date,
  zones,
  spaceId,
  onSpace,
  address,
  onAddress,
}: {
  kind: FormKind;
  date: string;
  zones: ZoneOption[];
  spaceId: string | null;
  onSpace: (id: string | null) => void;
  address: string;
  onAddress: (value: string) => void;
}) {
  if (kind === 'minicap') {
    return (
      <FormSection title="ГДЕ">
        <GlassCard style={formStyles.card}>
          <InfoRow icon="mappin.and.ellipse" label="Локация" value="TITAN" />
        </GlassCard>
      </FormSection>
    );
  }
  if (kind === 'exit') {
    return (
      <FormSection title="ГДЕ">
        <GlassCard style={formStyles.card}>
          <AddressField value={address} onChange={onAddress} placeholder="Город, улица, дом" />
        </GlassCard>
      </FormSection>
    );
  }
  if (zones.length === 0) return null;

  const chosen = zones.find((z) => z.id === spaceId);
  return (
    <FormSection title="ГДЕ">
      <GlassCard style={formStyles.card}>
        {zones.map((zone, index) => (
          <View key={zone.id}>
            {index > 0 && <View style={sheetStyles.separator} />}
            <ZoneRow
              zone={zone}
              date={date}
              selected={zone.id === spaceId}
              onPress={() => {
                haptic.selection();
                onSpace(zone.id === spaceId ? null : zone.id);
              }}
            />
          </View>
        ))}
      </GlassCard>
      {chosen?.conflict && (
        <Text style={[type.footnote, formStyles.warning]}>
          {`«${chosen.name}» ${busyText(chosen.conflict, date)}. Сохранить не получится — выберите другую зону или время.`}
        </Text>
      )}
    </FormSection>
  );
}

function ZoneRow({ zone, date, selected, onPress }: { zone: ZoneOption; date: string; selected: boolean; onPress: () => void }) {
  const { stacked } = useTextLayout();
  const rate = toNumber(zone.hourlyRate) > 0 ? `${formatMoney(toNumber(zone.hourlyRate))}/ч` : null;
  const status = zone.conflict ? busyText(zone.conflict, date) : zone.free ? 'свободна' : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={[zone.name, status, rate].filter(Boolean).join(', ')}>
      <SymbolView name={selected ? 'checkmark.circle.fill' : 'circle'} size={22} tintColor={selected ? colors.accent : colors.tertiaryLabel} />
      <View style={formStyles.flex}>
        <Text style={[type.body, sheetStyles.label]} numberOfLines={stacked ? 3 : 1}>
          {zone.name}
        </Text>
        {status ? (
          <Text style={[type.footnote, zone.conflict ? styles.busy : sheetStyles.secondary]} numberOfLines={2}>
            {status}
          </Text>
        ) : null}
        {stacked && rate ? <Text style={[type.footnote, sheetStyles.secondary]}>{rate}</Text> : null}
      </View>
      {!stacked && rate ? <Text style={[type.subhead, sheetStyles.secondary]}>{rate}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 54, paddingVertical: space.sm },
  busy: { color: colors.orange },
});
