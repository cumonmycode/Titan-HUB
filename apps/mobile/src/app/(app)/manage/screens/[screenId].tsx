import { ContentUnavailableView, Form, Host, Picker, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { ScreenPreview, swatchOf } from '@/components/screen-preview';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import {
  createSlide,
  deleteScreen,
  deviceStatus,
  durationLabel,
  pickScreenImages,
  reorderSlides,
  ROTATIONS,
  screenPageUrl,
  showItemSummary,
  THEMES,
  unpairScreen,
  updateScreen,
  useScreen,
  type ScreenPatch,
  type ScreenSlide,
} from '@/lib/screens-api';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const PREVIEW_MAX = 360;

/**
 * Один экран: превью телевизора, «Что показывать» — один плейлист по кругу (меню и
 * картинки, порядок меняется), оформление меню (тема и реклама внизу — отдельным экраном)
 * и сам телевизор (название, поворот, подключение). Правит владелец.
 */
export default function ScreenEditorScreen() {
  const { screenId } = useLocalSearchParams<{ screenId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const query = useScreen(screenId);
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);

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

  const active = show.filter((s) => s.isActive);
  // Пустой показ — тоже меню.
  const hasMenu = active.length === 0 || active.some((s) => s.kind === 'menu');
  const status = deviceStatus(screen);
  const device = [screen.deviceModel, screen.appVersion && `Titan Menu ${screen.appVersion}`].filter(Boolean).join(' · ');

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

  const addImages = async () => {
    if (busy) return;
    setBusy('Загружаем…');
    try {
      const urls = await pickScreenImages(true, (done, total) => setBusy(total > 1 ? `Загружаем ${done + 1} из ${total}…` : 'Загружаем…'));
      for (const url of urls) await createSlide(screen.id, { placement: 'show', kind: 'image', imageUrl: url, durationSec: 10, transition: 'fade', transitionMs: 900, fit: 'contain' });
      if (urls.length) haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Картинка не загрузилась', errorText(error));
    } finally {
      setBusy(null);
    }
  };
  const addMenu = () => void run(() => createSlide(screen.id, { placement: 'show', kind: 'menu', durationSec: 60, transition: 'fade', transitionMs: 900 }), 'Меню не добавилось');

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= show.length) return;
    haptic.selection();
    const next = [...show];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(() => reorderSlides(screen.id, next.map((s, i) => ({ id: s.id, sortOrder: i }))), 'Порядок не сохранился');
  };

  const unpair = () =>
    Alert.alert('Отвязать телевизор?', 'Приставка перестанет показывать этот экран и снова покажет код для подключения.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отвязать', style: 'destructive', onPress: () => void run(() => unpairScreen(screen.id), 'Не отвязался') },
    ]);
  const remove = () =>
    Alert.alert(`Удалить «${screen.name}»?`, 'Показ и реклама удалятся, приставка вернётся к экрану подключения.', [
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

  const openItem = (slide: ScreenSlide) => router.push({ pathname: '/manage/screens/slide', params: { screenId: screen.id, slideId: slide.id } });
  const images = show.filter((s) => s.kind === 'image');

  return (
    <>
      <Stack.Title>{screen.name}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section footer={<Text>{screen.paired ? (device ? `${device}. Приставка отмечается раз в 20 секунд.` : 'Приставка отмечается раз в 20 секунд.') : 'Телевизор не подключён — ниже «Подключить телевизор».'}</Text>}>
            <RNHostView matchContents>
              <View style={styles.preview}>
                <ScreenPreview rotation={screen.rotation} theme={screen.theme} first={active[0]} width={Math.min(width - 64, PREVIEW_MAX)} status={status} />
              </View>
            </RNHostView>
          </Section>

          <Section
            title="Что показывать"
            footer={
              <Text>
                {isOwner ? 'По кругу, сверху вниз. Нажмите на элемент, чтобы задать время показа и анимацию.' : 'Показ экрана настраивает владелец.'}
              </Text>
            }
          >
            {show.length === 0 ? (
              <LinkRow icon="menucard" color="#8B5CF6" title="Меню" subtitle="Показ пуст — телевизор показывает меню" chevron={false} />
            ) : (
              show.map((item, index) => (
                <RNHostView key={item.id} matchContents>
                  <PlaylistRow
                    item={item}
                    title={item.kind === 'menu' ? 'Меню' : `Картинка ${images.indexOf(item) + 1}`}
                    ordering={ordering}
                    first={index === 0}
                    last={index === show.length - 1}
                    onPress={isOwner && !ordering ? () => openItem(item) : undefined}
                    onUp={() => move(index, -1)}
                    onDown={() => move(index, 1)}
                  />
                </RNHostView>
              ))
            )}
            {isOwner && !ordering ? <ActionRow title={busy ?? 'Добавить картинки'} icon="photo.badge.plus" disabled={!!busy} onPress={() => void addImages()} /> : null}
            {isOwner && !ordering && !show.some((s) => s.kind === 'menu') ? <ActionRow title="Добавить меню" icon="menucard" disabled={!!busy} onPress={addMenu} /> : null}
            {isOwner && show.length > 1 ? (
              <ActionRow title={ordering ? 'Готово' : 'Изменить порядок'} icon={ordering ? 'checkmark.circle' : 'arrow.up.arrow.down'} onPress={() => setOrdering((v) => !v)} />
            ) : null}
          </Section>

          {hasMenu ? (
            <Section title="Оформление меню" footer={<Text>Что попадает в меню — кнопкой «На экране ТВ» у позиций в «Товарах» и «Тарифах».</Text>}>
              <RNHostView matchContents>
                <ThemeChips value={screen.theme} disabled={!isOwner} onChange={(theme) => save({ theme })} />
              </RNHostView>
              <LinkRow
                icon="rectangle.bottomthird.inset.filled"
                color="#FF9500"
                title="Реклама внизу меню"
                value={band.length ? `${band.filter((s) => s.isActive).length} · ${durationLabel(screen.bandSec)}` : 'нет'}
                onPress={() => router.push({ pathname: '/manage/screens/band', params: { screenId: screen.id } })}
              />
              <ActionRow title="Посмотреть на весь экран" icon="play.rectangle" onPress={() => void WebBrowser.openBrowserAsync(screenPageUrl(screen.id, screen.theme))} />
            </Section>
          ) : null}

          <Section title="Телевизор">
            {isOwner ? <TextRow key={screen.name} label="Название" value={screen.name} maxLength={60} onCommit={(name) => name && save({ name })} /> : <LinkRow title="Название" value={screen.name} chevron={false} />}
            <Picker label="Как висит" selection={screen.rotation} onSelectionChange={(next) => save({ rotation: Number(next) as ScreenPatch['rotation'] })} modifiers={[pickerStyle('menu')]}>
              {ROTATIONS.map((r) => (
                <Text key={r.key} modifiers={[tag(r.key)]}>
                  {r.label}
                </Text>
              ))}
            </Picker>
            {isOwner && !screen.paired ? (
              <ActionRow title="Подключить телевизор" icon="antenna.radiowaves.left.and.right" onPress={() => router.push({ pathname: '/manage/screens/connect', params: { screenId: screen.id } })} />
            ) : null}
            {isOwner && screen.paired ? <ActionRow title="Отвязать телевизор" icon="link.badge.plus" destructive onPress={unpair} /> : null}
          </Section>

          {isOwner ? (
            <Section>
              <ActionRow title="Удалить экран" icon="trash" destructive onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}

/** Элемент показа: миниатюра, что это, время и анимация; в режиме порядка — стрелки. */
function PlaylistRow({
  item,
  title,
  ordering,
  first,
  last,
  onPress,
  onUp,
  onDown,
}: {
  item: ScreenSlide;
  title: string;
  ordering: boolean;
  first: boolean;
  last: boolean;
  onPress?: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.thumb, !item.isActive && styles.off]}>
        {item.kind === 'image' && item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <SymbolView name="menucard.fill" size={22} tintColor="white" />
        )}
      </View>
      <View style={styles.flex}>
        <RNText style={[type.body, item.isActive ? styles.label : styles.tertiary]} numberOfLines={1}>
          {title}
        </RNText>
        <RNText style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {item.isActive ? showItemSummary(item) : 'Выключено'}
        </RNText>
      </View>
      {ordering ? (
        <View style={styles.arrows}>
          <Arrow icon="chevron.up" disabled={first} onPress={onUp} />
          <Arrow icon="chevron.down" disabled={last} onPress={onDown} />
        </View>
      ) : onPress ? (
        <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />
      ) : null}
    </Pressable>
  );
}

function Arrow({ icon, disabled, onPress }: { icon: 'chevron.up' | 'chevron.down'; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.arrow, (pressed || disabled) && styles.dim]}
      accessibilityRole="button"
      accessibilityLabel={icon === 'chevron.up' ? 'Выше' : 'Ниже'}
    >
      <SymbolView name={icon} size={14} weight="bold" tintColor={colors.accent} />
    </Pressable>
  );
}

/** Темы меню цветными плашками — видно, как будет выглядеть, до выбора. */
function ThemeChips({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (theme: string) => void }) {
  const current = THEMES.some((t) => t.key === value) ? value : 'night';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {THEMES.map((theme) => {
        const swatch = swatchOf(theme.key);
        const selected = theme.key === current;
        return (
          <Pressable
            key={theme.key}
            disabled={disabled || selected}
            onPress={() => onChange(theme.key)}
            style={[styles.chip, { backgroundColor: swatch.bg, borderColor: selected ? colors.accent : 'transparent' }]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Тема ${theme.name}`}
          >
            <View style={[styles.chipAccent, { backgroundColor: swatch.accent }]} />
            <RNText style={[type.footnote, styles.chipText, { color: swatch.ink }]} numberOfLines={1}>
              {theme.name}
            </RNText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  preview: { paddingVertical: space.md, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8, minHeight: 60 },
  pressed: { opacity: 0.6 },
  thumb: { width: 52, height: 40, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#8B5CF6' },
  off: { opacity: 0.4 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  arrows: { flexDirection: 'row', gap: space.sm },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  dim: { opacity: 0.35 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  chip: { width: 96, height: 64, borderRadius: 12, borderCurve: 'continuous', padding: 8, justifyContent: 'space-between', borderWidth: 2.5 },
  chipAccent: { width: 28, height: 6, borderRadius: 3 },
  chipText: { fontWeight: '600' },
});
