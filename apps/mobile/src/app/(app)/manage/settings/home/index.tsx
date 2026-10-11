import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import {
  newZoneId,
  normalizeHaUrl,
  refreshHaDevices,
  removeHaConnection,
  saveHaConnection,
  saveZones,
  useHaDevices,
  useSmartHome,
  useSmartHomeToken,
  zoneSummary,
  zoneSymbol,
} from '@/lib/smart-home-api';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fail = (error: unknown) => {
  haptic.error();
  Alert.alert('Не сохранилось', errorText(error));
};

/** Цвет плашки помещения — по его значку, как у пунктов «Настроек». */
const ZONE_COLORS: Record<string, string> = {
  'door.left.hand.open': '#FF9500',
  sofa: '#AF52DE',
  toilet: '#30B0C7',
  wineglass: '#FF2D55',
  tree: '#34C759',
  'person.3': '#5856D6',
  house: '#18BCF2',
};

/**
 * Home Assistant для HUB: адрес и свой долгосрочный токен (не тот, что у планшетов Titan
 * Home), проверка связи и помещения клуба с устройствами. Помещения с устройствами
 * появляются в шторке «Свет и климат» на главной кассы у всех сотрудников.
 */
export default function SmartHomeSettingsScreen() {
  const router = useRouter();
  const config = useSmartHome();
  const token = useSmartHomeToken();
  const data = config.data;
  const devices = useHaDevices(data?.hasToken ? data.url : null, token);

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const zones = data.zones;

  const saveUrl = (input: string) => {
    const url = normalizeHaUrl(input);
    if (!url) {
      Alert.alert('Не похоже на адрес', 'Например: 192.168.1.50 или http://homeassistant.local:8123');
      return;
    }
    saveHaConnection({ url })
      .then(() => {
        haptic.success();
        void refreshHaDevices();
      })
      .catch(fail);
  };

  const askToken = () => {
    const url = data.url;
    if (!url) {
      Alert.alert('Сначала адрес', 'Введите адрес Home Assistant, потом токен.');
      return;
    }
    promptText(
      data.hasToken ? 'Новый токен' : 'Долгосрочный токен',
      'Home Assistant → профиль пользователя → «Безопасность» → «Долгосрочные токены доступа» → «Создать токен». Скопируйте его сюда целиком.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (value?: string) => {
            const next = (value ?? '').trim();
            if (next.length < 20) {
              Alert.alert('Это не токен', 'Токен Home Assistant — длинная строка, обычно начинается с «eyJ».');
              return;
            }
            saveHaConnection({ url, token: next })
              .then(() => {
                haptic.success();
                void refreshHaDevices();
              })
              .catch(fail);
          },
        },
      ],
      'secure-text',
    );
  };

  const addZone = () =>
    promptText('Новое помещение', 'Например: «Веранда» или «VIP-кабинка».', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Добавить',
        onPress: (value?: string) => {
          const name = (value ?? '').trim().slice(0, 40);
          if (!name) return;
          const zone = { id: newZoneId(), name, lights: [], climates: [] };
          saveZones([...zones, zone])
            .then(() => {
              haptic.success();
              router.push({ pathname: '/manage/settings/home/zone', params: { zoneId: zone.id } });
            })
            .catch(fail);
        },
      },
    ]);

  const disconnect = () =>
    Alert.alert('Отключить Home Assistant?', 'Шторка «Свет и климат» пропадёт с кассы у всех сотрудников. Помещения и устройства останутся.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () =>
          removeHaConnection()
            .then(() => haptic.success())
            .catch(fail),
      },
    ]);

  const found = devices.data?.devices ?? [];
  const lightsFound = found.filter((d) => d.domain !== 'climate').length;
  const climatesFound = found.length - lightsFound;
  const link = !data.hasToken
    ? { value: 'нужен токен', color: colors.secondaryLabel }
    : devices.isFetching
      ? { value: 'проверяем…', color: colors.secondaryLabel }
      : devices.data
        ? { value: `есть · ${lightsFound} света, ${climatesFound} климат`, color: colors.green }
        : devices.error
          ? { value: 'нет', color: colors.red }
          : { value: '—', color: colors.secondaryLabel };

  const urlFooter =
    data.urlSource === 'tablet'
      ? 'Адрес взят у планшетов Titan Home. Измените, если телефонам нужен другой (например, внешний https).'
      : 'Телефон подключается к Home Assistant сам, по Wi‑Fi клуба. Для работы вне клуба подойдёт внешний https-адрес.';

  return (
    <>
      <Stack.Title>Home Assistant</Stack.Title>
      {zones.length > 1 && (
        <Stack.Toolbar placement="right">
          <ToolbarButton icon="arrow.up.arrow.down" accessibilityLabel="Порядок помещений" onPress={() => router.push('/manage/settings/home/reorder')} />
        </Stack.Toolbar>
      )}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form
          modifiers={[
            refreshable(async () => {
              await Promise.allSettled([config.refetch(), devices.refetch()]);
            }),
          ]}>
          <Section title="Подключение" footer={<Text>{urlFooter}</Text>}>
            <TextRow
              label="Адрес"
              value={data.url ?? ''}
              placeholder="192.168.1.50:8123"
              keyboard="url"
              capitalize="never"
              maxLength={300}
              onCommit={saveUrl}
            />
            <LinkRow
              icon="key"
              color="#8E8E93"
              title="Токен для HUB"
              value={data.hasToken ? 'задан' : 'не задан'}
              valueColor={data.hasToken ? undefined : colors.orange}
              onPress={askToken}
            />
            <LinkRow
              icon="dot.radiowaves.left.and.right"
              color="#18BCF2"
              title="Связь"
              value={link.value}
              valueColor={link.color}
              chevron={false}
              onPress={data.hasToken ? () => void devices.refetch() : undefined}
            />
          </Section>

          {devices.error && (
            <Section footer={<Text>{`${errorText(devices.error)} Токен — отдельный от планшетов: создайте его от пользователя HA без прав администратора.`}</Text>}>
              <ActionRow title="Проверить ещё раз" icon="arrow.clockwise" onPress={() => void devices.refetch()} />
            </Section>
          )}

          <Section title="Помещения" footer={<Text>В шторке на кассе — в этом порядке. Помещения без устройств там не показываются.</Text>}>
            {zones.map((zone) => {
              const symbol = zoneSymbol(zone.name);
              return (
                <LinkRow
                  key={zone.id}
                  icon={symbol}
                  color={ZONE_COLORS[symbol] ?? '#18BCF2'}
                  title={zone.name}
                  value={zoneSummary(zone)}
                  onPress={() => router.push({ pathname: '/manage/settings/home/zone', params: { zoneId: zone.id } })}
                />
              );
            })}
            <ActionRow title="Добавить помещение" icon="plus" onPress={addZone} />
          </Section>

          {data.hasToken && (
            <Section>
              <ActionRow title="Отключить Home Assistant" icon="xmark.circle" destructive onPress={disconnect} />
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
