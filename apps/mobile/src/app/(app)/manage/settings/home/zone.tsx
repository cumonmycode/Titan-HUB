import { Button, ContentUnavailableView, Form, Host, ProgressView, Section, SwipeActions, Text } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { MAX_DEVICE_NAME, saveZones, useSmartHome, type DeviceKind, type Zone, type ZoneDevice } from '@/lib/smart-home-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fail = (error: unknown) => {
  haptic.error();
  Alert.alert('Не сохранилось', errorText(error));
};

type Group = { key: 'lights' | 'climates'; kind: DeviceKind; title: string; add: string; icon: SFSymbol; color: string; footer: string };

const GROUPS: Group[] = [
  {
    key: 'lights',
    kind: 'light',
    title: 'Свет',
    add: 'Выбрать свет',
    icon: 'lightbulb.fill',
    color: '#FFCC00',
    footer: 'На кассе каждая лампа — плитка: касание включает и выключает. Подходят лампы, группы света и выключатели.',
  },
  {
    key: 'climates',
    kind: 'climate',
    title: 'Кондиционеры',
    add: 'Выбрать кондиционер',
    icon: 'snowflake',
    color: '#32ADE6',
    footer: 'На кассе: питание, температура и режим.',
  },
];

/**
 * Помещение клуба: название и устройства Home Assistant. Всё сохраняется сразу — как в
 * «Настройках» iOS. Подпись устройства на кассе меняется касанием, убирается смахиванием.
 */
export default function SmartHomeZoneScreen() {
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const router = useRouter();
  const config = useSmartHome();
  const zones = config.data?.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);

  if (!zone) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.data ? <ContentUnavailableView title="Помещение удалено" systemImage="house" /> : <ProgressView />}
      </Host>
    );
  }

  const update = (patch: Partial<Zone>) => saveZones(zones.map((z) => (z.id === zone.id ? { ...z, ...patch } : z))).catch(fail);

  const rename = (next: string) => {
    const name = next.trim().slice(0, 40);
    if (!name) {
      Alert.alert('Нужно название', 'Так помещение подписано в шторке на кассе.');
      return;
    }
    void update({ name });
  };

  const renameDevice = (group: Group, device: ZoneDevice) =>
    promptText(
      'Подпись на кассе',
      device.entityId,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (value?: string) => {
            const name = (value ?? '').trim().slice(0, MAX_DEVICE_NAME);
            if (!name || name === device.name) return;
            void update({ [group.key]: zone[group.key].map((d) => (d.entityId === device.entityId ? { ...d, name } : d)) });
          },
        },
      ],
      'plain-text',
      device.name,
    );

  const removeDevice = (group: Group, device: ZoneDevice) => {
    haptic.light();
    void update({ [group.key]: zone[group.key].filter((d) => d.entityId !== device.entityId) });
  };

  const removeZone = () =>
    Alert.alert(`Удалить «${zone.name}»?`, 'Помещение пропадёт из шторки на кассе. Устройства в Home Assistant не тронем.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          saveZones(zones.filter((z) => z.id !== zone.id))
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch(fail);
        },
      },
    ]);

  return (
    <>
      <Stack.Title>{zone.name}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section>
            <TextRow key={zone.id} label="Название" value={zone.name} placeholder="Например, Зал" maxLength={40} onCommit={rename} />
          </Section>

          {GROUPS.map((group) => (
            <Section key={group.key} title={group.title} footer={<Text>{group.footer}</Text>}>
              {zone[group.key].map((device) => (
                <SwipeActions key={device.entityId}>
                  <LinkRow icon={group.icon} color={group.color} title={device.name} subtitle={device.entityId} onPress={() => renameDevice(group, device)} />
                  <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
                    <Button role="destructive" label="Убрать" systemImage="minus.circle" onPress={() => removeDevice(group, device)} />
                  </SwipeActions.Actions>
                </SwipeActions>
              ))}
              <ActionRow
                title={group.add}
                icon="plus"
                onPress={() => router.push({ pathname: '/manage/settings/home/devices', params: { zoneId: zone.id, kind: group.kind } })}
              />
            </Section>
          ))}

          <Section>
            <ActionRow title="Удалить помещение" icon="trash" destructive onPress={removeZone} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
