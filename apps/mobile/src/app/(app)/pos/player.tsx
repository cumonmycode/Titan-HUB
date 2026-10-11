import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { Text, TextInput } from '@/components/text';
import { GlassCard, PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { PlayerCard, PlayerSearch, TariffGrid, useTariffChoice } from '@/components/player-picker';
import { haptic } from '@/lib/haptics';
import { usePosPlayer } from '@/lib/payment';
import { addItem, setCheckGuests, setCheckPlayer, type PlayerSearchItem } from '@/lib/pos-api';
import { useCheck } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

/** Кого добавляем: плательщика чека или ещё одного участника («один платит за двоих»). */
type Target = { kind: 'payer'; player: PlayerSearchItem } | { kind: 'guest'; name: string; player: PlayerSearchItem | null };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Клиенты чека, как в веб-кассе: без плательщика найденный клиент становится плательщиком,
 * с плательщиком — добавляется участником. Участника можно добавить и просто по имени.
 * После выбора — тариф по статусу, он ляжет в чек позицией.
 */
export default function CheckPeopleSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const check = useCheck(checkId);
  const payerId = check.data?.playerId ?? null;
  const payer = usePosPlayer(payerId);
  const guests = check.data?.guestNames ?? [];
  const [query, setQuery] = useState('');
  const [guestName, setGuestName] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => router.back();

  const go = (next: Target | null) => {
    haptic.selection();
    Keyboard.dismiss();
    setTarget(next);
  };

  const pickPlayer = (player: PlayerSearchItem) => {
    setQuery('');
    go(payerId ? { kind: 'guest', name: player.nickname, player } : { kind: 'payer', player });
  };

  const addGuestByName = () => {
    const name = guestName.trim();
    if (!name) return;
    setGuestName('');
    go({ kind: 'guest', name, player: null });
  };

  const removePayer = () => {
    Alert.alert('Убрать плательщика?', 'Скидки по статусу клиента пересчитаются. Бонусы и депозит к этому чеку применить будет нельзя.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Убрать',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await setCheckPlayer(checkId, null);
            haptic.success();
          } catch (error) {
            haptic.error();
            Alert.alert('Плательщик не убран', errorText(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const removeGuest = async (name: string) => {
    haptic.light();
    try {
      await setCheckGuests(
        checkId,
        guests.filter((n) => n !== name),
      );
    } catch (error) {
      haptic.error();
      Alert.alert('Участник не убран', errorText(error));
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title={target ? 'Тариф' : 'Клиенты чека'} onBack={target ? () => go(null) : undefined} onClose={close} />

      <LayoutAnimationConfig skipEntering>
        <Animated.View key={target ? 'tariff' : 'main'} entering={(target ? FadeInRight : FadeInLeft).duration(220)} exiting={FadeOut.duration(90)} style={styles.step}>
          {target ? (
            <AttachStep
              checkId={checkId}
              target={target}
              guests={guests}
              onDone={() => {
                haptic.success();
                close();
              }}
            />
          ) : (
            <>
              {payerId && (
                <View style={styles.block}>
                  <Text style={[type.footnote, styles.sectionTitle]}>ПЛАТЕЛЬЩИК</Text>
                  {payer.data && <PlayerCard player={payer.data} />}
                  <Pressable style={({ pressed }) => [styles.textButton, pressed && styles.pressed]} onPress={removePayer} disabled={busy} accessibilityRole="button">
                    <Text style={[type.subhead, styles.destructive]}>{busy ? 'Убираем…' : 'Убрать плательщика'}</Text>
                  </Pressable>
                </View>
              )}

              {guests.length > 0 && (
                <View style={styles.block}>
                  <Text style={[type.footnote, styles.sectionTitle]}>УЧАСТНИКИ</Text>
                  <GlassCard>
                    {guests.map((name, index) => (
                      <View key={name}>
                        {index > 0 && <View style={[sheetStyles.separator, styles.guestSeparator]} />}
                        <View style={styles.guestRow}>
                          <SymbolView name="person.fill" size={16} tintColor={colors.secondaryLabel} />
                          <Text style={[type.body, sheetStyles.label, styles.flex]} numberOfLines={1}>
                            {name}
                          </Text>
                          <Pressable hitSlop={10} onPress={() => void removeGuest(name)} accessibilityRole="button" accessibilityLabel={`Убрать ${name}`}>
                            <SymbolView name="xmark.circle.fill" size={20} tintColor={colors.tertiaryLabel} />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </GlassCard>
                </View>
              )}

              <Text style={[type.footnote, styles.hint]}>
                {payerId ? 'Найдите клиента — он добавится участником этого чека' : 'Найдите клиента — он станет плательщиком чека'}
              </Text>
              <PlayerSearch query={query} onQuery={setQuery} onPlayer={pickPlayer} excludeId={payerId} />

              {payerId && (
                <GlassCard style={styles.nameRow}>
                  <TextInput
                    value={guestName}
                    onChangeText={setGuestName}
                    placeholder="Участник без профиля — имя"
                    placeholderTextColor={colors.tertiaryLabel}
                    selectionColor={colors.accent}
                    style={[type.body, styles.nameInput]}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={addGuestByName}
                  />
                  <Pressable
                    disabled={!guestName.trim()}
                    onPress={addGuestByName}
                    style={({ pressed }) => [styles.addName, !guestName.trim() && styles.disabled, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Text style={[type.subhead, styles.addNameText]}>Добавить</Text>
                  </Pressable>
                </GlassCard>
              )}
            </>
          )}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

function AttachStep({ checkId, target, guests, onDone }: { checkId: string; target: Target; guests: string[]; onDone: () => void }) {
  const clientTier = target.player?.clientTier ?? '';
  const choice = useTariffChoice(clientTier);
  const [busy, setBusy] = useState(false);
  const asPayer = target.kind === 'payer';

  const confirm = async () => {
    haptic.medium();
    setBusy(true);
    try {
      if (target.kind === 'payer') await setCheckPlayer(checkId, target.player.id);
      else if (!guests.includes(target.name)) await setCheckGuests(checkId, [...guests, target.name]);
      const tariff = choice.selectedTariff;
      if (tariff?.itemId) {
        // Человек уже в чеке — ошибка тарифа не должна это отменять.
        await addItem(checkId, tariff.itemId).catch((error: Error) => Alert.alert('Тариф не добавлен', error.message));
      }
      onDone();
    } catch (error) {
      haptic.error();
      Alert.alert(asPayer ? 'Плательщик не привязан' : 'Участник не добавлен', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const card = target.player ?? { nickname: target.kind === 'guest' ? target.name : '', clientTier: '', balance: '0', bonusPoints: '0', photoUrl: null };

  return (
    <>
      <PlayerCard player={card} caption={asPayer ? 'Станет плательщиком' : target.player ? 'Участник чека' : 'Участник без профиля'} />
      <TariffGrid choice={choice} noTariffCaption={asPayer ? 'Только привязать клиента' : 'Только добавить участника'} />
      <PrimaryButton
        title={busy ? 'Сохраняем…' : asPayer ? 'Привязать клиента' : 'Добавить участника'}
        busy={busy}
        disabled={!choice.ready}
        onPress={() => void confirm()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  step: { gap: space.md },
  flex: { flex: 1 },
  block: { gap: space.sm },
  sectionTitle: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  textButton: { alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.xs },
  destructive: { color: colors.red, fontWeight: '600' },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, minHeight: 50 },
  guestSeparator: { marginLeft: 44 },
  hint: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs },
  nameInput: { flex: 1, color: colors.label, height: 48 },
  addName: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 999, backgroundColor: colors.accent },
  addNameText: { color: 'white', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
});
