import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DangerRow, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { useZoneStates, ZoneList } from '@/components/zone-list';
import { haptic } from '@/lib/haptics';
import { setCheckSpace } from '@/lib/pos-api';
import { useCheck } from '@/lib/queries';
import { space, type } from '@/lib/theme';

/**
 * Зона открытого чека: добавить аренду чеку без зоны, пересадить гостей в другую зону или
 * снять аренду. Занятые зоны не выбираются, сегодняшние брони видны в строке зоны.
 */
export default function ZoneSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const check = useCheck(checkId);
  const { zones, loading } = useZoneStates(checkId);
  const [busy, setBusy] = useState<string | null>(null);
  const data = check.data;
  const current = data?.spaceId ?? null;
  const open = data?.status === 'open';

  const apply = async (spaceId: string | null, failTitle: string) => {
    setBusy(spaceId ?? 'none');
    try {
      await setCheckSpace(checkId, spaceId);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(failTitle, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const pick = (spaceId: string) => {
    if (!current) return void apply(spaceId, 'Аренда не добавлена');
    const target = zones.find((z) => z.space.id === spaceId)?.space.name ?? 'другую зону';
    Alert.alert(`Пересадить в «${target}»?`, 'Время аренды сохранится, вся аренда посчитается по ставке новой зоны.', [
      { text: 'Назад', style: 'cancel' },
      { text: 'Пересадить', onPress: () => void apply(spaceId, 'Не пересадили') },
    ]);
  };

  const remove = () =>
    Alert.alert('Снять аренду?', 'Зона освободится, а аренда пропадёт из чека — вместе с уже набежавшим временем.', [
      { text: 'Назад', style: 'cancel' },
      { text: 'Снять', style: 'destructive', onPress: () => void apply(null, 'Аренда не снята') },
    ]);

  return (
    <View style={styles.sheet}>
      <SheetHeader title={current ? 'Зона чека' : 'Аренда зоны'} onClose={() => router.back()} />
      <ZoneList zones={zones} loading={loading} currentSpaceId={current} busySpaceId={open ? busy : 'closed'} onPick={pick} />
      <Text style={[type.footnote, sheetStyles.secondary, styles.note]}>
        {current ? 'Пересадка сохраняет время аренды.' : 'Аренда пойдёт с этой минуты, по начатым часам — до оплаты чека.'}
      </Text>
      {current && open ? <DangerRow title="Снять аренду" icon="xmark.circle" busy={busy === 'none'} onPress={remove} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  note: { paddingHorizontal: space.xs },
});
