import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { FormSection } from '@/components/form-parts';
import { Avatar, GlassCard, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { PlayerSearch } from '@/components/player-picker';
import {
  addParticipant,
  eventErrorMessage,
  MINICAP_MAX_PLAYERS,
  useEventParticipants,
  type ParticipantRole,
} from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import { createClient, TIER_LABEL, type ClientTier } from '@/lib/pos-api';
import { colors, space, type } from '@/lib/theme';
import { chooseAction } from '@/lib/dialog';

const rowLayout = LinearTransition.springify().damping(22).stiffness(220);
/** Как в веб-кассе: новому участнику миникапа выбирают один из трёх статусов. */
const NEW_CLIENT_TIERS: ClientTier[] = ['guest', 'resident', 'student'];

const errorText = (error: unknown) => eventErrorMessage(error instanceof Error ? error.message : String(error));

/**
 * Набор состава миникапа: поиск игрока с клавиатурой сразу, тап — игрок в составе, шторка
 * остаётся открытой для следующего. Судья один — после выбора шторка закрывается.
 */
export default function ParticipantsSheet() {
  const { eventId, role: roleParam } = useLocalSearchParams<{ eventId: string; role?: ParticipantRole }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lineup = useEventParticipants(eventId);
  const [role, setRole] = useState<ParticipantRole>(roleParam === 'judge' ? 'judge' : 'player');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const list = lineup.data ?? [];
  const players = list.filter((p) => p.role === 'player');
  const judge = list.find((p) => p.role === 'judge') ?? null;
  const full = role === 'player' ? players.length >= MINICAP_MAX_PLAYERS : judge !== null;

  const add = async (profileId: string, nickname: string) => {
    haptic.medium();
    setAdding(nickname);
    try {
      await addParticipant(eventId, profileId, role);
      haptic.success();
      setQuery('');
      if (role === 'judge') router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(`${nickname} не в составе`, errorText(error));
    } finally {
      setAdding(null);
    }
  };

  const createAndAdd = (nickname: string) => {
    if (nickname.length < 2) return Alert.alert('Ник — минимум 2 символа');
    chooseAction(`Новый клиент «${nickname}»`, 'Выберите статус клиента', [
      ...NEW_CLIENT_TIERS.map((tier) => ({
        text: TIER_LABEL[tier] ?? tier,
        onPress: async () => {
          setAdding(nickname);
          try {
            const profileId = await createClient(nickname, tier);
            await add(profileId, nickname);
          } catch (error) {
            haptic.error();
            setAdding(null);
            Alert.alert('Клиент не создан', errorText(error));
          }
        },
      })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS}
        showsVerticalScrollIndicator={false}>
        <SheetHeader title="Состав миникапа" onClose={() => router.back()} />

        <Host matchContents={{ vertical: true }} style={styles.stretch}>
          <Picker
            selection={role}
            onSelectionChange={(value) => {
              haptic.selection();
              setRole(value as ParticipantRole);
            }}
            modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('player')]}>{`Игроки · ${players.length}/${MINICAP_MAX_PLAYERS}`}</SwiftText>
            <SwiftText modifiers={[tag('judge')]}>{judge ? 'Судья · 1/1' : 'Судья'}</SwiftText>
          </Picker>
        </Host>

        {adding && (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={styles.adding}>
            <ActivityIndicator />
            <Text style={[type.subhead, sheetStyles.secondary]}>{`Добавляем ${adding}…`}</Text>
          </Animated.View>
        )}

        {list.length > 0 && (
          <FormSection title={`В СОСТАВЕ · ${list.length}`}>
            <GlassCard>
              {[...(judge ? [judge] : []), ...players].map((p, index) => (
                <Animated.View key={p.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                  {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
                  <View style={styles.row}>
                    <Avatar name={p.nickname ?? '··'} size={36} />
                    <View style={styles.flex}>
                      <Text style={[type.body, sheetStyles.label]} numberOfLines={1}>
                        {p.nickname ?? 'Игрок'}
                      </Text>
                      {p.clientTier && <Text style={[type.footnote, sheetStyles.secondary]}>{TIER_LABEL[p.clientTier] ?? p.clientTier}</Text>}
                    </View>
                    {p.role === 'judge' ? (
                      <View style={styles.judgeBadge}>
                        <SymbolView name="person.badge.shield.checkmark.fill" size={12} tintColor={colors.orange} />
                        <Text style={[type.caption1, styles.judgeText]}>Судья</Text>
                      </View>
                    ) : (
                      <SymbolView name="checkmark.circle.fill" size={20} tintColor={colors.green} />
                    )}
                  </View>
                </Animated.View>
              ))}
            </GlassCard>
          </FormSection>
        )}

        <LayoutAnimationConfig skipEntering>
          {full ? (
            <Animated.View key={`full-${role}`} entering={FadeIn.duration(180)}>
              <GlassCard tint="rgba(52,199,89,0.16)" style={styles.notice}>
                <SymbolView name="checkmark.seal.fill" size={22} tintColor={colors.green} />
                <Text style={[type.subhead, sheetStyles.label, styles.flex]}>
                  {role === 'player'
                    ? `Состав заполнен — ${MINICAP_MAX_PLAYERS} игроков. Чтобы заменить игрока, уберите его в карточке миникапа.`
                    : `Судья — ${judge?.nickname ?? 'назначен'}. Заменить можно в карточке миникапа.`}
                </Text>
              </GlassCard>
            </Animated.View>
          ) : (
            <Animated.View key={`search-${role}`} entering={FadeIn.duration(180)} style={styles.search}>
              <PlayerSearch
                query={query}
                onQuery={setQuery}
                onPlayer={(player) => void add(player.id, player.nickname)}
                onCreate={createAndAdd}
                excludeIds={list.map((p) => p.profileId)}
              />
            </Animated.View>
          )}
        </LayoutAnimationConfig>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  stretch: { alignSelf: 'stretch' },
  search: { gap: space.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  adding: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  separator: { marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 54 },
  judgeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,149,0,0.16)',
  },
  judgeText: { color: colors.orange, fontWeight: '600' },
});
