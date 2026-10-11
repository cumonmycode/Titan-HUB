import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import {
  BAND_DURATIONS,
  ROTATIONS,
  THEMES,
  createSlide,
  deleteScreen,
  deviceStatus,
  myTitanSlide,
  pickScreenImages,
  screenPageUrl,
  showItemSummary,
  showLabel,
  unpairScreen,
  updateScreen,
  useScreen,
  withCurrent,
  type ScreenPatch,
  type ScreenSlide,
} from '@/lib/screens-api';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function bandTitle(slide: ScreenSlide, index: number): string {
  return slide.kind === 'image' ? `Картинка ${index + 1}` : slide.title || 'Карточка';
}

function bandSubtitle(slide: ScreenSlide): string {
  const parts = [`${slide.durationSec} с`];
  if (slide.kind === 'card') parts.push(slide.linkUrl ? `QR → ${slide.linkUrl.replace(/^https?:\/\//, '')}` : 'без QR');
  return parts.join(' · ');
}

/**
 * Один экран: телевизор (статус, подключение, отвязка), как висит ТВ, показ (по кругу
 * меню и картинки), а если в показе есть меню — его тема, лента и реклама. Правит владелец.
 */
export default function ScreenEditorScreen() {
  const { screenId } = useLocalSearchParams<{ screenId: string }>();
  const router = useRouter();
  const query = useScreen(screenId);
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState<string | null>(null);

  const screen = query.data?.screen;
  const show = query.data?.show ?? [];
  const band = query.data?.slides ?? [];

  if (query.isLoading) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  if (!screen) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ContentUnavailableView title="Экран не найден" systemImage="tv.slash" description={query.error?.message ?? 'Его могли удалить.'} />
      </Host>
    );
  }

  // Тема и лента нужны, только если меню есть в показе (пустой показ — тоже меню).
  const active = show.filter((s) => s.isActive);
  const hasMenu = active.length === 0 || active.some((s) => s.kind === 'menu');
  const status = deviceStatus(screen);
  const device = [screen.deviceModel, screen.appVersion && `Titan Menu ${screen.appVersion}`, screen.deviceIp].filter(Boolean).join(' · ');
  const images = show.filter((s) => s.kind === 'image');

  const run = async (action: () => Promise<void>, failure: string) => {
    try {
      await action();
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert(failure, errorText(error));
    }
  };

  const save = (patch: ScreenPatch) => {
    if (!isOwner) return;
    haptic.selection();
    void run(() => updateScreen(screen.id, patch), 'Не сохранилось');
  };

  // Картинки в показ — несколько сразу; в ленту — по одной.
  const addImages = async (placement: 'show' | 'band') => {
    if (busy) return;
    setBusy('Загружаем…');
    try {
      const urls = await pickScreenImages(placement === 'show', (done, total) => setBusy(total > 1 ? `Загружаем ${done + 1} из ${total}…` : 'Загружаем…'));
      for (const url of urls) {
        await createSlide(screen.id, { placement, kind: 'image', imageUrl: url, durationSec: 10, transition: 'fade', transitionMs: 900, fit: 'contain' });
      }
      if (urls.length) haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Картинка не загрузилась', errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const addMenu = () =>
    void run(() => createSlide(screen.id, { placement: 'show', kind: 'menu', durationSec: 60, transition: 'fade', transitionMs: 900 }), 'Меню не добавилось');
  const addMyTitan = () => void run(() => createSlide(screen.id, myTitanSlide()), 'Карточка не добавилась');

  const unpair = () =>
    Alert.alert('Отвязать телевизор?', 'Приставка перестанет показывать этот экран и снова покажет код для подключения.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отвязать', style: 'destructive', onPress: () => void run(() => unpairScreen(screen.id), 'Не отвязался') },
    ]);

  const remove = () =>
    Alert.alert(`Удалить «${screen.name}»?`, 'Настройки, показ и реклама удалятся, приставка вернётся к экрану подключения.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await deleteScreen(screen.id);
            router.back();
          }, 'Экран не удалён'),
      },
    ]);

  const openItem = (slide?: ScreenSlide, kind?: 'card') =>
    router.push({ pathname: '/manage/screens/slide', params: { screenId: screen.id, ...(slide ? { slideId: slide.id } : {}), ...(kind ? { kind } : {}) } });

  return (
    <>
      <Stack.Title>{screen.name}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form
          modifiers={[
            refreshable(async () => {
              await query.refetch();
            }),
          ]}>
          <Section title="Телевизор" footer={<Text>{screen.paired ? 'Приставка показывает этот экран и отмечается раз в 20 секунд.' : 'Откройте Titan Menu на приставке — на экране появится код. Телефон найдёт её в той же Wi‑Fi сети.'}</Text>}>
            <LinkRow icon="tv" color={status.color} title={status.label} subtitle={device || undefined} />
            {isOwner && !screen.paired && (
              <ActionRow title="Подключить ТВ" icon="antenna.radiowaves.left.and.right" onPress={() => router.push({ pathname: '/manage/screens/connect', params: { screenId: screen.id } })} />
            )}
            <ActionRow title="Открыть экран" icon="eye" onPress={() => void WebBrowser.openBrowserAsync(screenPageUrl(screen.id))} />
            {isOwner && screen.paired && <ActionRow title="Отвязать ТВ" icon="link.badge.plus" destructive onPress={unpair} />}
          </Section>

          <Section title="Экран">
            {isOwner ? (
              <TextRow key={screen.name} label="Название" value={screen.name} maxLength={60} onCommit={(name) => name && save({ name })} />
            ) : (
              <LinkRow title="Название" value={screen.name} />
            )}
            <Picker label="Как висит ТВ" selection={screen.rotation} onSelectionChange={(next) => save({ rotation: Number(next) as ScreenPatch['rotation'] })} modifiers={[pickerStyle('menu')]}>
              {ROTATIONS.map((r) => (
                <Text key={r.key} modifiers={[tag(r.key)]}>
                  {r.label}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section
            title={`Показ · ${showLabel(screen.show)}`}
            footer={
              <Text>
                {isOwner
                  ? 'По кругу, сверху вниз. Картинка появляется поверх меню на весь экран, меню — из-под уходящей картинки. Нажмите на элемент, чтобы задать время, анимацию и её скорость.'
                  : 'Показ экрана настраивает владелец.'}
              </Text>
            }>
            {show.length === 0 && <Text>Показ пуст — экран показывает меню</Text>}
            {show.map((item) => (
              <LinkRow
                key={item.id}
                icon={item.kind === 'menu' ? 'menucard' : 'photo'}
                color={item.isActive ? (item.kind === 'menu' ? '#8B5CF6' : '#FF9500') : '#8E8E93'}
                title={item.kind === 'menu' ? 'Меню' : `Картинка ${images.indexOf(item) + 1}`}
                subtitle={showItemSummary(item)}
                value={item.isActive ? undefined : 'Выкл.'}
                onPress={isOwner ? () => openItem(item) : undefined}
              />
            ))}
            {isOwner && <ActionRow title={busy ?? 'Добавить картинки'} icon="photo.badge.plus" disabled={!!busy} onPress={() => void addImages('show')} />}
            {isOwner && <ActionRow title="Добавить меню" icon="menucard" disabled={!!busy} onPress={addMenu} />}
          </Section>

          {hasMenu && (
            <>
              <Section title="Оформление меню" footer={<Text>Состав меню — кнопкой «На экране ТВ» у позиций в «Меню» и «Тарифах».</Text>}>
                <Picker label="Тема" selection={THEMES.some((t) => t.key === screen.theme) ? screen.theme : 'night'} onSelectionChange={(next) => save({ theme: String(next) })} modifiers={[pickerStyle('menu')]}>
                  {THEMES.map((t) => (
                    <Text key={t.key} modifiers={[tag(t.key)]}>
                      {t.name}
                    </Text>
                  ))}
                </Picker>
                <ActionRow title="Посмотреть тему на весь экран" icon="play.rectangle" onPress={() => void WebBrowser.openBrowserAsync(screenPageUrl(screen.id, screen.theme))} />
              </Section>

              <Section
                title="Реклама в ленте меню"
                footer={<Text>{isOwner ? 'Слайды по очереди сменяют ленту тарифов внизу меню: панель переворачивается, меню остаётся на месте. Картинка лучше широкая, примерно 3:1.' : 'Рекламу на экране настраивает владелец.'}</Text>}>
                <Picker label="Лента тарифов" selection={screen.bandSec} onSelectionChange={(next) => save({ bandSec: Number(next) })} modifiers={[pickerStyle('menu')]}>
                  {withCurrent(BAND_DURATIONS, screen.bandSec).map((sec) => (
                    <Text key={sec} modifiers={[tag(sec)]}>
                      {`${sec} с`}
                    </Text>
                  ))}
                </Picker>
                {band.map((slide, i) => (
                  <LinkRow
                    key={slide.id}
                    icon={slide.kind === 'image' ? 'photo' : 'qrcode'}
                    color={slide.isActive ? (slide.kind === 'image' ? '#FF9500' : '#8B5CF6') : '#8E8E93'}
                    title={bandTitle(slide, i)}
                    subtitle={bandSubtitle(slide)}
                    value={slide.isActive ? undefined : 'Скрыт'}
                    onPress={isOwner ? () => openItem(slide) : undefined}
                  />
                ))}
              </Section>
              {isOwner && (
                <Section>
                  <ActionRow title={busy ?? 'Добавить картинку в ленту'} icon="photo.badge.plus" disabled={!!busy} onPress={() => void addImages('band')} />
                  <ActionRow title="Добавить карточку с QR" icon="qrcode" disabled={!!busy} onPress={() => openItem(undefined, 'card')} />
                  <ActionRow title="QR приложения My Titan" icon="iphone" disabled={!!busy} onPress={addMyTitan} />
                </Section>
              )}
            </>
          )}

          {isOwner && (
            <Section>
              <ActionRow title="Удалить экран" icon="trash" destructive onPress={remove} />
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
