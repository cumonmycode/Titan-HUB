// Кабинки клуба: перенести планшет в другую кабинку (без повторной настройки — у
// каждой кабинки свои устройства умного дома) и настроить устройства любой из них.
// Своя кабинка — первой: это единственное место выбора устройств.
import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import { ArrowLeft, ArrowLeftRight, Lightbulb, SlidersHorizontal, Snowflake, Sofa, Tablet } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { errorText } from '@/data/api';
import { useHost } from '@/data/query';
import { useSession } from '@/data/session';
import { type Booth, fetchBooths, staffUnlocked, switchBooth, useStaff } from '@/features/staff/staff';
import { Background } from '@/ui/background';
import { Button } from '@/ui/button';
import { Loader } from '@/ui/controls';
import { Glass } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { ScreenHeader } from '@/ui/screen-header';
import { T } from '@/ui/text';
import { toast } from '@/ui/toast';
import { color, GUTTER, radius } from '@/ui/tokens';

export default function BoothsScreen() {
  const router = useRouter();
  const host = useHost();
  const current = useSession((s) => s.space?.id ?? null);
  const touch = useStaff((s) => s.touch);
  const [moving, setMoving] = useState<string | null>(null);
  const booths = useQuery({ queryKey: [host, 'booths'], queryFn: fetchBooths, staleTime: 10_000, retry: false });

  if (!staffUnlocked()) return <Redirect href="/staff" />;

  const move = (booth: Booth) => {
    touch();
    Alert.alert(`Перенести планшет в «${booth.name}»?`, 'Экран гостя и свет с климатом переключатся на эту кабинку. PIN вводить не нужно.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Перенести',
        onPress: () => {
          setMoving(booth.id);
          switchBooth(booth.id)
            .then(() => {
              toast(`Планшет теперь в «${booth.name}»`);
              router.back();
            })
            .catch((e: unknown) => toast(errorText(e), 'error'))
            .finally(() => setMoving(null));
        },
      },
    ]);
  };

  const list = [...(booths.data ?? [])].sort((a, b) => Number(b.id === current) - Number(a.id === current));

  return (
    <View style={styles.screen}>
      <Background />
      <ScreenHeader icon={ArrowLeft} label="Назад" onBack={() => router.back()} title="Кабинки" caption="У каждой кабинки свои свет и кондиционер — планшет берёт их при переносе" />
      {booths.isLoading ? (
        <Loader label="Загружаем кабинки…" />
      ) : booths.isError ? (
        <Loader label={errorText(booths.error)} />
      ) : (
        <ScrollView contentContainerStyle={styles.grid} onScrollBeginDrag={touch} showsVerticalScrollIndicator={false}>
          {list.map((booth) => (
            <BoothCard
              key={booth.id}
              booth={booth}
              here={booth.id === current}
              moving={moving === booth.id}
              busy={moving !== null}
              onDevices={() => {
                touch();
                router.push({ pathname: '/staff/room', params: { spaceId: booth.id } });
              }}
              onMove={() => move(booth)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function BoothCard({ booth, here, moving, busy, onDevices, onMove }: {
  booth: Booth; here: boolean; moving: boolean; busy: boolean; onDevices: () => void; onMove: () => void;
}) {
  const devices = [
    ...booth.room.lights.map((l) => ({ key: l.entityId, icon: Lightbulb, name: l.name, tone: color.warm })),
    ...(booth.room.climate ? [{ key: booth.room.climate.entityId, icon: Snowflake, name: booth.room.climate.name, tone: color.cool }] : []),
  ];
  return (
    <Glass kind={here ? 'accent' : 'panel'} radius={radius.card} style={[styles.card, here && { backgroundColor: color.accentTint }]}>
      <View style={styles.cardHead}>
        <Icon as={Sofa} size={26} tone={here ? color.accentSoft : color.textSecondary} />
        <T variant="heading" numberOfLines={1} style={{ flex: 1 }}>{booth.name}</T>
        {here ? (
          <View style={styles.here}>
            <Icon as={Tablet} size={15} tone={color.accentSoft} />
            <T variant="small" tone="accent">Этот планшет</T>
          </View>
        ) : null}
      </View>
      {devices.length ? (
        <View style={styles.devices}>
          {devices.map((d) => (
            <View key={d.key} style={styles.device}>
              <Icon as={d.icon} size={16} tone={d.tone} />
              <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{d.name}</T>
            </View>
          ))}
        </View>
      ) : (
        <T variant="caption" tone="tertiary">Устройства не выбраны</T>
      )}
      <View style={styles.actions}>
        <Button title="Устройства" icon={SlidersHorizontal} onPress={onDevices} disabled={busy} style={{ flex: 1 }} />
        {here ? null : <Button title="Перенести сюда" icon={ArrowLeftRight} variant="primary" onPress={onMove} loading={moving} disabled={busy} style={{ flex: 1 }} />}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 20 },
  grid: { paddingTop: 16, paddingBottom: GUTTER, flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { flexGrow: 1, flexBasis: 320, gap: 12, padding: 18 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  here: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: 'rgba(139,92,246,0.22)' },
  devices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  device: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: 12, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: color.hairline,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
