import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/text';
import { useDialogStore, type DialogButton, type DialogRequest } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { colors, radius, space, type, useAccentHex } from '@/lib/theme';

/** Цвета значков шторки действий — как цветные квадраты разделов «Управления». */
const ICON_TONES = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#14B8A6'];
const DESTRUCTIVE = '#FF3B30';
/** Выезд без пружины: пружина перелетала и отскакивала — шторка «прыгала». */
const SHEET_IN = SlideInDown.duration(320).easing(Easing.out(Easing.cubic));

/**
 * Android-диалоги из `lib/dialog.ts`: поле ввода вместо отсутствующего `Alert.prompt`
 * и шторка действий снизу (меню «+» и «…» в шапке, быстрые действия чека). На iOS
 * ничего не рисует — там системные Alert и меню.
 */
export function DialogHost() {
  const current = useDialogStore((s) => s.queue[0]);
  if (Platform.OS === 'ios' || !current) return null;
  // key — новый диалог получает свежее поле ввода, а не текст предыдущего.
  return current.kind === 'prompt' ? <PromptDialog key={current.id} request={current} /> : <ActionSheet key={current.id} request={current} />;
}

function close(request: DialogRequest, button?: DialogButton, value?: string) {
  useDialogStore.getState().shift();
  button?.onPress?.(request.kind === 'prompt' ? value : undefined);
}

function PromptDialog({ request }: { request: DialogRequest }) {
  const accent = useAccentHex();
  const [value, setValue] = useState(request.defaultValue ?? '');
  const cancel = request.buttons.find((b) => b.style === 'cancel');
  // Основное действие поля — последняя не-отменяющая кнопка, как «Готово» в Alert.prompt.
  const primary = [...request.buttons].reverse().find((b) => b.style !== 'cancel');

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => close(request, cancel, value)}>
      <Pressable style={styles.backdropCenter} onPress={() => close(request, cancel, value)}>
        {/* Карточка перехватывает касания, чтобы тап по ней не закрывал диалог. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={[type.title3, styles.title]}>{request.title}</Text>
          {request.message ? <Text style={[type.subhead, styles.message]}>{request.message}</Text> : null}
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            secureTextEntry={request.secure}
            keyboardType={request.keyboardType}
            selectionColor={accent}
            cursorColor={accent}
            placeholderTextColor={colors.tertiaryLabel}
            returnKeyType="done"
            onSubmitEditing={() => close(request, primary, value)}
            style={[type.body, styles.input, { borderBottomColor: accent }]}
          />
          <View style={styles.actions}>
            {request.buttons.map((button, index) => (
              <Pressable
                key={index}
                onPress={() => {
                  haptic.selection();
                  close(request, button, value);
                }}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                accessibilityRole="button">
                <Text
                  style={[
                    type.headline,
                    { color: button.style === 'destructive' ? colors.red : button.style === 'cancel' ? colors.secondaryLabel : accent },
                  ]}>
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Шторка действий, как лист действий iPhone: карточка снизу с «ручкой», каждая строка —
 * цветной значок и подпись, «Отмена» — отдельной капсулой. Раньше меню открывались
 * диалогом посередине экрана и выглядели чужеродно.
 */
function ActionSheet({ request }: { request: DialogRequest }) {
  const insets = useSafeAreaInsets();
  const accent = useAccentHex();
  const cancel = request.buttons.find((b) => b.style === 'cancel');
  const actions = request.buttons.filter((b) => b.style !== 'cancel');

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => close(request, cancel)}>
      <Pressable style={styles.backdropBottom} onPress={() => close(request, cancel)}>
        <Animated.View entering={SHEET_IN} style={[styles.sheetWrap, { paddingBottom: Math.max(insets.bottom, space.md) + space.sm }]}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.grabber} />
            {request.title ? <Text style={[type.headline, styles.sheetTitle]}>{request.title}</Text> : null}
            {request.message ? <Text style={[type.footnote, styles.sheetMessage]}>{request.message}</Text> : null}
            <View style={styles.rows}>
              {actions.map((button, index) => {
                const destructive = button.style === 'destructive';
                const tone = destructive ? DESTRUCTIVE : ICON_TONES[index % ICON_TONES.length]!;
                return (
                  <Pressable
                    key={index}
                    onPress={() => {
                      haptic.selection();
                      close(request, button);
                    }}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    accessibilityRole="button">
                    <View style={[styles.iconTile, { backgroundColor: `${tone}1F` }]}>
                      <SymbolView name={(button.icon ?? (destructive ? 'trash' : 'circle.fill')) as SFSymbol} size={18} tintColor={tone} />
                    </View>
                    <Text style={[type.body, styles.rowText, destructive && styles.destructiveText]} numberOfLines={1}>
                      {button.text}
                    </Text>
                    {button.checked ? <SymbolView name="checkmark" size={18} tintColor={accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
          <Pressable
            onPress={() => close(request, cancel)}
            style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]}
            accessibilityRole="button">
            <Text style={[type.headline, { color: accent }]}>{cancel?.text ?? 'Отмена'}</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.xxl },
  backdropBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: colors.floating,
    borderRadius: radius.card,
    paddingTop: space.xl,
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
    gap: space.sm,
    elevation: 12,
  },
  title: { color: colors.label },
  message: { color: colors.secondaryLabel },
  input: { color: colors.label, borderBottomWidth: 2, paddingVertical: space.sm, marginTop: space.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs, marginTop: space.sm },
  action: { paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.small },
  pressed: { opacity: 0.55 },

  sheetWrap: { paddingHorizontal: space.sm, gap: space.sm },
  sheet: { backgroundColor: colors.floating, borderRadius: 28, paddingTop: space.sm, paddingBottom: space.sm, overflow: 'hidden' },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: space.sm },
  sheetTitle: { color: colors.label, textAlign: 'center', paddingHorizontal: space.xl },
  sheetMessage: { color: colors.secondaryLabel, textAlign: 'center', paddingHorizontal: space.xl, marginTop: 2 },
  rows: { marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg },
  rowPressed: { backgroundColor: colors.fill },
  iconTile: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, color: colors.label, fontWeight: '500' },
  destructiveText: { color: DESTRUCTIVE },
  cancel: { minHeight: 56, paddingVertical: space.sm, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.floating },
});
