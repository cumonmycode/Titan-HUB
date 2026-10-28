import { Picker, Section, Slider, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import {
  HA_STATE,
  MESSAGE_PRESETS,
  MESSAGE_SECONDS,
  nowOnScreen,
  sendScreenCommand,
  updateScreen,
  useScreens,
  volumePercent,
  type Screen,
  type ScreenCommand,
  type ScreenSlide,
} from '@/lib/screens-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const VOLUME_STEP = 5;
const OWN = 'own';
const AS_MENU = 'menu';

/**
 * ТВ в кабинке (Titan TV): что на нём сейчас, пульт, сообщение гостям и реклама на главном экране
 * и заставке. Команды уходят на ТВ сразу и доступны персоналу; рекламу настраивает владелец.
 */
export function BoothTvSections({ screen, band, isOwner }: { screen: Screen; band: ScreenSlide[]; isOwner: boolean }) {
  return (
    <>
      <NowSection screen={screen} />
      <RemoteSection screen={screen} />
      <MessageSection screen={screen} />
      <AdsSection screen={screen} band={band} isOwner={isOwner} />
    </>
  );
}

async function send(screen: Screen, command: ScreenCommand): Promise<boolean> {
  try {
    await sendScreenCommand(screen.id, command);
    haptic.success();
    return true;
  } catch (error) {
    haptic.error();
    Alert.alert('Команда не дошла', errorText(error));
    return false;
  }
}

function NowSection({ screen }: { screen: Screen }) {
  const state = screen.deviceState;
  if (!state) {
    return (
      <Section title="Сейчас на ТВ">
        <Text>{screen.online ? 'ТВ на связи, состояние придёт в течение 20 секунд.' : 'ТВ не на связи — состояние появится, когда он вернётся в сеть.'}</Text>
      </Section>
    );
  }
  const ha = state.ha ? HA_STATE[state.ha] : null;
  const track = state.airplay ? [state.airplay.title || 'Без названия', state.airplay.artist].filter(Boolean).join(' — ') : null;
  return (
    <Section title="Сейчас на ТВ">
      <LinkRow icon={state.screen === 'input' ? 'cable.connector' : state.screen === 'app' ? 'square.grid.2x2' : 'tv'} color="#8B5CF6" title={nowOnScreen(state)} chevron={false} />
      {track ? <LinkRow icon={state.airplay?.playing ? 'music.note' : 'pause.fill'} color="#FF2D55" title={track} subtitle={state.airplay?.client || undefined} chevron={false} /> : null}
      {state.volume ? (
        <LinkRow
          icon={state.volume.muted ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
          color="#007AFF"
          title={state.volume.muted ? 'Звук выключен' : 'Громкость'}
          value={state.volume.muted ? undefined : `${volumePercent(state.volume)}%`}
          chevron={false}
        />
      ) : null}
      {ha ? <LinkRow icon="lightbulb.fill" color="#FF9500" title={ha.label} valueColor={ha.color} chevron={false} /> : null}
    </Section>
  );
}

function RemoteSection({ screen }: { screen: Screen }) {
  const volume = screen.deviceState?.volume ?? null;
  const [percent, setPercent] = useState<number | null>(null);
  // Ползунок держит своё значение, пока его двигают; потом снова показывает то, что прислал ТВ.
  useEffect(() => setPercent(null), [volume?.level, volume?.max]);
  const shown = percent ?? (volume ? volumePercent(volume) : 50);
  const disabled = !screen.online;

  const reset = () =>
    Alert.alert('Сбросить после гостей?', 'Главный экран, приложения гостей закроются, громкость станет 30%.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сбросить', onPress: () => void send(screen, { action: 'reset' }) },
    ]);

  return (
    <Section title="Пульт" footer={<Text>{disabled ? 'ТВ не на связи — команды не дойдут.' : 'Команды выполняются на ТВ сразу, поверх любого приложения.'}</Text>}>
      <ActionRow title="На главный экран" icon="house" disabled={disabled} onPress={() => void send(screen, { action: 'home' })} />
      <ActionRow title="Заставка" icon="moon.stars" disabled={disabled} onPress={() => void send(screen, { action: 'screensaver' })} />
      <ActionRow title="Сбросить после гостей" icon="sparkles" disabled={disabled} onPress={reset} />
      <Slider
        value={shown}
        min={0}
        max={100}
        step={VOLUME_STEP}
        label={<Text>Громкость</Text>}
        minimumValueLabel={<Text>{`${shown}%`}</Text>}
        onValueChange={setPercent}
        onEditingChanged={(editing) => {
          if (!editing && percent != null && !disabled) void send(screen, { action: 'volume', percent });
        }}
      />
      <Toggle label="Без звука" isOn={!!volume?.muted} onIsOnChange={(muted) => !disabled && void send(screen, { action: 'mute', muted })} />
    </Section>
  );
}

function MessageSection({ screen }: { screen: Screen }) {
  const disabled = !screen.online;
  const show = (text: string) => void send(screen, { action: 'message', text, seconds: MESSAGE_SECONDS });
  const custom = () =>
    promptText('Сообщение на ТВ', 'Появится вверху экрана поверх фильма и исчезнет само.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Показать',
        onPress: (value?: string) => {
          const text = (value ?? '').trim();
          if (text) show(text.slice(0, 200));
        },
      },
    ]);
  return (
    <Section title="Сообщение на экран" footer={<Text>{`Гости увидят его вверху экрана ${MESSAGE_SECONDS} секунд, пульт у них продолжит работать.`}</Text>}>
      {MESSAGE_PRESETS.map((preset) => (
        <ActionRow key={preset.label} title={preset.label} icon="text.bubble" disabled={disabled} onPress={() => show(preset.text)} />
      ))}
      <ActionRow title="Своё сообщение…" icon="square.and.pencil" disabled={disabled} onPress={custom} />
    </Section>
  );
}

/** Реклама: включена ли и чья лента — как на ТВ с меню (по умолчанию), другого экрана или своя. */
function AdsSection({ screen, band, isOwner }: { screen: Screen; band: ScreenSlide[]; isOwner: boolean }) {
  const router = useRouter();
  const screens = useScreens();
  const others = (screens.data ?? []).filter((s) => s.id !== screen.id && s.deviceApp !== 'launcher');
  const own = screen.adsScreenId === screen.id;
  const fallback = others.find((s) => s.show.menu);
  const source = own ? screen : (others.find((s) => s.id === screen.adsScreenId) ?? fallback);
  const selection = own ? OWN : (screen.adsScreenId ?? AS_MENU);

  const save = async (patch: Parameters<typeof updateScreen>[1]) => {
    if (!isOwner) return;
    haptic.selection();
    try {
      await updateScreen(screen.id, patch);
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    }
  };

  return (
    <Section title="Реклама" footer={<Text>Блок справа от плиток на главном экране и в углу заставки: картинки и карточки с QR по очереди.</Text>}>
      <Toggle label="Показывать рекламу" isOn={screen.adsEnabled} onIsOnChange={(adsEnabled) => void save({ adsEnabled })} />
      {screen.adsEnabled ? (
        <Picker
          label="Какая реклама"
          selection={selection}
          onSelectionChange={(next) => {
            const value = String(next);
            void save({ adsScreenId: value === OWN ? screen.id : value === AS_MENU ? null : value });
          }}
          modifiers={[pickerStyle('menu')]}
        >
          <Text modifiers={[tag(AS_MENU)]}>{fallback ? `Как на «${fallback.name}»` : 'Как на ТВ с меню'}</Text>
          {others
            .filter((s) => s.id !== fallback?.id)
            .map((s) => (
              <Text key={s.id} modifiers={[tag(s.id)]}>{`Как на «${s.name}»`}</Text>
            ))}
          <Text modifiers={[tag(OWN)]}>Своя для этого ТВ</Text>
        </Picker>
      ) : null}
      {screen.adsEnabled && source && isOwner ? (
        <LinkRow
          icon="megaphone"
          color="#FF9500"
          title={own ? 'Своя реклама' : `Реклама «${source.name}»`}
          value={own ? `${band.filter((s) => s.isActive).length}` : undefined}
          onPress={() => router.push({ pathname: '/manage/screens/band', params: { screenId: source.id } })}
        />
      ) : null}
    </Section>
  );
}
