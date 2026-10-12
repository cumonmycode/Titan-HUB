import { Form, Host, Picker, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ActionRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { BAND_DURATIONS, createSlide, durationLabel, myTitanSlide, pickScreenImages, updateScreen, useScreen, withCurrent, type ScreenSlide } from '@/lib/screens-api';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Реклама внизу меню: слайды по очереди сменяют ленту тарифов (панель переворачивается,
 * меню остаётся на месте). Картинка, карточка с QR или приглашение в My Titan.
 */
export default function ScreenBandScreen() {
  const { screenId } = useLocalSearchParams<{ screenId: string }>();
  const router = useRouter();
  const query = useScreen(screenId);
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [busy, setBusy] = useState(false);
  const screen = query.data?.screen;
  const band = query.data?.slides ?? [];

  if (!screen) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }

  const run = async (action: () => Promise<void>, failure: string) => {
    try {
      await action();
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert(failure, errorText(error));
    }
  };
  const addImage = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [url] = await pickScreenImages(false);
      if (url) {
        await createSlide(screen.id, { placement: 'band', kind: 'image', imageUrl: url, durationSec: 10, transition: 'fade', transitionMs: 900, fit: 'contain' });
        haptic.success();
      }
    } catch (error) {
      haptic.error();
      Alert.alert('Картинка не загрузилась', errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const open = (slide?: ScreenSlide, kind?: 'card') =>
    router.push({ pathname: '/manage/screens/slide', params: { screenId: screen.id, ...(slide ? { slideId: slide.id } : {}), ...(kind ? { kind } : {}) } });

  return (
    <>
      <Stack.Title>Реклама внизу меню</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section footer={<Text>Слайды по очереди сменяют ленту тарифов внизу меню. Картинка лучше широкая, примерно 3:1.</Text>}>
            <Picker
              label="Лента тарифов"
              selection={screen.bandSec}
              onSelectionChange={(next) => isOwner && void run(() => updateScreen(screen.id, { bandSec: Number(next) }), 'Не сохранилось')}
              modifiers={[pickerStyle('menu')]}
            >
              {withCurrent(BAND_DURATIONS, screen.bandSec).map((sec) => (
                <Text key={sec} modifiers={[tag(sec)]}>
                  {durationLabel(sec)}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title="Слайды">
            {band.length === 0 ? <Text>Рекламы пока нет — внизу меню идут тарифы.</Text> : null}
            {band.map((slide, index) => (
              <RNHostView key={slide.id} matchContents>
                <BandRow slide={slide} index={index} onPress={isOwner ? () => open(slide) : undefined} />
              </RNHostView>
            ))}
          </Section>

          {isOwner ? (
            <Section title="Добавить">
              <ActionRow title={busy ? 'Загружаем…' : 'Картинку'} icon="photo.badge.plus" disabled={busy} onPress={() => void addImage()} />
              <ActionRow title="Карточку с QR-кодом" icon="qrcode" disabled={busy} onPress={() => open(undefined, 'card')} />
              <ActionRow title="Приглашение в My Titan" icon="iphone" disabled={busy} onPress={() => void run(() => createSlide(screen.id, myTitanSlide()), 'Карточка не добавилась')} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}

function BandRow({ slide, index, onPress }: { slide: ScreenSlide; index: number; onPress?: () => void }) {
  const title = slide.kind === 'image' ? `Картинка ${index + 1}` : slide.title || 'Карточка';
  const details = [durationLabel(slide.durationSec), slide.kind === 'card' ? (slide.linkUrl ? `QR → ${slide.linkUrl.replace(/^https?:\/\//, '')}` : 'без QR') : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.thumb, !slide.isActive && styles.off]}>
        {slide.kind === 'image' && slide.imageUrl ? <Image source={{ uri: slide.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <SymbolView name="qrcode" size={20} tintColor="white" />}
      </View>
      <View style={styles.flex}>
        <RNText style={[type.body, slide.isActive ? styles.label : styles.tertiary]} numberOfLines={1}>
          {title}
        </RNText>
        <RNText style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {slide.isActive ? details : 'Скрыт'}
        </RNText>
      </View>
      {onPress ? <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8, minHeight: 56 },
  pressed: { opacity: 0.6 },
  thumb: { width: 72, height: 24, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF9500' },
  off: { opacity: 0.4 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
});
