import { Host, Label, List, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { environment, foregroundStyle, listStyle } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { haptic } from '@/lib/haptics';
import { saveZones, useSmartHome, zoneSymbol, type Zone } from '@/lib/smart-home-api';
import { useAccentHex } from '@/lib/theme';

/** SwiftUI `onMove`: индексы источников и место вставки в исходном массиве. */
function moveRows<T>(list: T[], sources: number[], destination: number): T[] {
  const moving = sources.map((index) => list[index]!);
  const rest = list.filter((_, index) => !sources.includes(index));
  const at = destination - sources.filter((index) => index < destination).length;
  rest.splice(at, 0, ...moving);
  return rest;
}

/** Порядок помещений — так же они идут в шторке «Свет и климат» на кассе. */
export default function SmartHomeReorderScreen() {
  const config = useSmartHome();
  const zones = config.data?.zones;
  if (!zones) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  return <ReorderList zones={zones} />;
}

function ReorderList({ zones }: { zones: Zone[] }) {
  const router = useRouter();
  const accent = useAccentHex();
  const [order, setOrder] = useState(zones);
  const [busy, setBusy] = useState(false);
  const changed = order.some((zone, index) => zone.id !== zones[index]?.id);

  const save = async () => {
    haptic.medium();
    setBusy(true);
    try {
      await saveZones(order);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Порядок не сохранён', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Порядок помещений" canSave={changed} busy={busy} onSave={() => void save()} />
      <Host style={{ flex: 1 }} useViewportSizeMeasurement seedColor={accent}>
        <List modifiers={[environment('editMode', 'active'), listStyle('insetGrouped')]}>
          <Section footer={<Text>{`${Platform.OS === 'ios' ? 'Потяните за полоски справа.' : 'Двигайте строки стрелками справа.'} В таком порядке помещения будут в шторке на кассе.`}</Text>}>
            <List.ForEach
              onMove={(sources, destination) => {
                haptic.selection();
                setOrder((current) => moveRows(current, sources, destination));
              }}>
              {order.map((zone) => (
                <Label key={zone.id} title={zone.name} systemImage={zoneSymbol(zone.name)} modifiers={[foregroundStyle('primary')]} />
              ))}
            </List.ForEach>
          </Section>
        </List>
      </Host>
    </>
  );
}
