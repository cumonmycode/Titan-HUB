import { Form, HStack, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow, secondary } from '@/components/native-form';
import { chooseAction, promptText, type DialogButton } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { createScreen, pairTv, probeTv, scanForTvs, useScreens, type FoundTv, type Screen } from '@/lib/screens-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * «Подключить ТВ»: телефон перебирает свою Wi‑Fi сеть и показывает приставки с Titan Menu
 * (код с экрана телевизора, модель, IP). Выбрали приставку и экран — телефон берёт в HUB
 * одноразовый секрет и передаёт его приставке; через пару секунд ТВ показывает экран.
 * Если сеть не даёт найти приставку (гостевой Wi‑Fi, другая подсеть) — ввести IP с экрана ТВ.
 */
export default function ConnectTvScreen() {
  const { screenId } = useLocalSearchParams<{ screenId?: string }>();
  const router = useRouter();
  const screens = useScreens();
  const [found, setFound] = useState<FoundTv[]>([]);
  const [scanning, setScanning] = useState(true); // первый поиск стартует сразу при открытии
  const [scanError, setScanError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const add = useCallback((tv: FoundTv) => {
    setFound((list) => [...list.filter((x) => x.deviceId !== tv.deviceId), tv].sort((a, b) => Number(a.paired) - Number(b.paired)));
  }, []);

  const runScan = useCallback(() => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    scanForTvs(add, controller.signal)
      .catch((error: unknown) => setScanError(errorText(error)))
      .finally(() => {
        if (abort.current === controller) setScanning(false);
      });
  }, [add]);

  useEffect(() => {
    runScan();
    return () => abort.current?.abort();
  }, [runScan]);

  const scan = () => {
    setFound([]);
    setScanError(null);
    setScanning(true);
    runScan();
  };

  const enterIp = () =>
    promptText(
      'IP приставки',
      'Он написан внизу экрана подключения на телевизоре.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Найти',
          onPress: (value?: string) => {
            const ip = (value ?? '').trim();
            if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
              Alert.alert('Нужен IP', 'Например 192.168.1.3');
              return;
            }
            void probeTv(ip, undefined, 4000).then((tv) => {
              if (tv) {
                haptic.success();
                add(tv);
              } else {
                haptic.error();
                Alert.alert('Не нашли приставку', `По адресу ${ip} нет Titan Menu. Проверьте, что приложение открыто и телефон в той же сети.`);
              }
            });
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );

  const connect = async (tv: FoundTv, screen: Screen) => {
    setPairing(tv.deviceId);
    haptic.medium();
    try {
      await pairTv(tv, screen.id);
      haptic.success();
      Alert.alert('Готово', `Телевизор показывает экран «${screen.name}». Настройки экрана — здесь, в HUB.`);
      router.replace({ pathname: '/manage/screens/[screenId]', params: { screenId: screen.id } });
    } catch (error) {
      haptic.error();
      Alert.alert('Не подключился', errorText(error));
    } finally {
      setPairing(null);
    }
  };

  const connectToNew = (tv: FoundTv) =>
    promptText(
      'Новый экран',
      'Как назвать этот телевизор?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Дальше',
          onPress: (value?: string) => {
            // Новый экран сразу показывает меню; картинки добавляются в его показ потом.
            const name = (value ?? '').trim() || `ТВ ${tv.code}`;
            void createScreen({ name })
              .then((screen) => connect(tv, screen))
              .catch((error: unknown) => Alert.alert('Экран не создан', errorText(error)));
          },
        },
      ],
      'plain-text',
      `ТВ ${tv.code}`,
    );

  const choose = (tv: FoundTv) => {
    if (pairing) return;
    if (tv.paired) {
      Alert.alert(
        'Приставка уже подключена',
        `Она показывает экран «${tv.screenName ?? ''}». Чтобы подключить её к другому, сначала отвяжите её в настройках того экрана.`,
      );
      return;
    }
    const list = screens.data ?? [];
    const target = screenId ? list.find((s) => s.id === screenId) : undefined;
    if (target) {
      Alert.alert(`Подключить ${tv.name}?`, `Телевизор начнёт показывать экран «${target.name}».`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Подключить', onPress: () => void connect(tv, target) },
      ]);
      return;
    }
    const buttons: DialogButton[] = [
      ...list.map((s) => ({
        text: s.paired ? `${s.name} (заменить ТВ)` : s.name,
        onPress: () => void connect(tv, s),
      })),
      { text: 'Новый экран…', onPress: () => connectToNew(tv) },
      { text: 'Отмена', style: 'cancel' as const },
    ];
    chooseAction(`Что показывает ${tv.name}?`, 'Выберите экран из HUB — его настройки сразу появятся на телевизоре.', buttons);
  };

  return (
    <>
      <Stack.Title>Подключить ТВ</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section
            title="Найдены в сети"
            footer={
              <Text>
                {scanError ??
                  'Откройте Titan Menu на приставке — на экране будет код. Телефон и приставка должны быть в одной Wi‑Fi сети. Если iPhone спросит про доступ к локальной сети — разрешите и нажмите «Искать снова».'}
              </Text>
            }>
            {found.map((tv) => (
              <LinkRow
                key={tv.deviceId}
                icon="tv"
                color={tv.paired ? '#8E8E93' : '#8B5CF6'}
                title={`Код ${tv.code}`}
                subtitle={`${tv.model} · ${tv.ip}`}
                value={pairing === tv.deviceId ? 'Подключаем…' : tv.paired ? `«${tv.screenName ?? ''}»` : 'Свободна'}
                onPress={() => choose(tv)}
              />
            ))}
            {scanning && (
              <HStack spacing={10}>
                <ProgressView />
                <Text modifiers={[secondary]}>Ищем приставки в сети…</Text>
              </HStack>
            )}
            {!scanning && found.length === 0 && !scanError && <Text modifiers={[secondary]}>Приставок не нашли</Text>}
          </Section>

          <Section>
            <ActionRow title="Искать снова" icon="arrow.clockwise" disabled={scanning} onPress={scan} />
            <ActionRow title="Ввести IP вручную" icon="keyboard" onPress={enterIp} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
