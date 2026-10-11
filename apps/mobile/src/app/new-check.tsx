import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { Text, TextInput } from '@/components/text';
import { GlassCard, PrimaryButton, QuickTile, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { PlayerCard, PlayerSearch, TariffGrid, useTariffChoice } from '@/components/player-picker';
import { useAutoFocus } from '@/lib/auto-focus';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createCheckErrorMessage, openCreatedCheck } from '@/lib/new-check';
import { addEntryTariff, createCheck, createClient, SPACE_TYPE_LABEL, useSpaces, type ClientTier, type PlayerSearchItem, type Tariff } from '@/lib/pos-api';
import { useChecks } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

/**
 * Шторка «Новый чек» — по высоте содержимого, как модалка веб-кассы. Шаги сменяют друг
 * друга внутри одной шторки: поиск игрока → тариф, новый клиент или аренда зоны.
 * Поле поиска получает фокус сразу — клавиатура поднимается вместе со шторкой.
 */

type Step = { name: 'search' } | { name: 'tariff'; player: PlayerSearchItem } | { name: 'client'; nickname: string } | { name: 'space' };
type CreateInput = { playerId?: string; spaceId?: string; tariffItemId?: string | null };

const TITLES: Record<Step['name'], string> = {
  search: 'Новый чек',
  tariff: 'Тариф',
  client: 'Новый клиент',
  space: 'Аренда зоны',
};



export default function NewCheckSheet() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'search' });
  const [forward, setForward] = useState(true);
  const [query, setQuery] = useState('');

  const create = useMutation({
    mutationFn: async (input: CreateInput) => {
      const check = await createCheck({ playerId: input.playerId, spaceId: input.spaceId });
      // Как веб: тариф — это позиция меню; её ошибка не отменяет уже открытый чек,
      // но о ней показываем предупреждение (см. addEntryTariff).
      if (input.tariffItemId) await addEntryTariff(check.id, input.tariffItemId);
      return check;
    },
    onSuccess: (check) => openCreatedCheck(router, check),
    onError: (error) => {
      haptic.error();
      Alert.alert('Чек не открыт', createCheckErrorMessage(error.message));
    },
  });

  const go = (next: Step) => {
    haptic.selection();
    if (next.name !== 'client') Keyboard.dismiss();
    setForward(next.name !== 'search');
    setStep(next);
  };

  const busyInput = create.isPending ? create.variables : undefined;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={TITLES[step.name]}
        onBack={step.name === 'search' ? undefined : () => go({ name: 'search' })}
        onClose={() => router.back()}
      />

      {/* Первый шаг появляется вместе со шторкой; сдвиг — только при переходах между шагами. */}
      <LayoutAnimationConfig skipEntering>
      <Animated.View
        key={step.name}
        entering={(forward ? FadeInRight : FadeInLeft).duration(220)}
        exiting={FadeOut.duration(90)}
        style={styles.step}>
        {step.name === 'search' && (
          <SearchStep
            query={query}
            onQuery={setQuery}
            onPlayer={(player) => go({ name: 'tariff', player })}
            onNewClient={(nickname) => go({ name: 'client', nickname })}
            onSpace={() => go({ name: 'space' })}
            onNoClient={() => {
              haptic.light();
              create.mutate({});
            }}
            noClientBusy={!!busyInput && !busyInput.playerId && !busyInput.spaceId}
          />
        )}
        {step.name === 'tariff' && (
          <TariffStep
            player={step.player}
            busy={create.isPending}
            onOpen={(tariff) => create.mutate({ playerId: step.player.id, tariffItemId: tariff?.itemId })}
          />
        )}
        {step.name === 'client' && <ClientStep initialNickname={step.nickname} onCreate={(playerId) => create.mutate({ playerId })} creatingCheck={create.isPending} />}
        {step.name === 'space' && <SpaceStep busySpaceId={busyInput?.spaceId} onPick={(spaceId) => create.mutate({ spaceId })} />}
      </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

/* ─────────────────────────── Поиск ─────────────────────────── */

function SearchStep({
  query,
  onQuery,
  onPlayer,
  onNewClient,
  onSpace,
  onNoClient,
  noClientBusy,
}: {
  query: string;
  onQuery: (q: string) => void;
  onPlayer: (player: PlayerSearchItem) => void;
  onNewClient: (nickname: string) => void;
  onSpace: () => void;
  onNoClient: () => void;
  noClientBusy: boolean;
}) {
  return (
    <View style={styles.stepGap}>
      <View style={styles.quickRow}>
        <QuickTile icon="person.crop.circle.badge.questionmark" title="Без клиента" tint={colors.gray} busy={noClientBusy} onPress={onNoClient} />
        <QuickTile icon="person.badge.plus" title="Новый клиент" tint={colors.blue} onPress={() => onNewClient(query.trim())} />
        <QuickTile icon="timer" title="Аренда" tint={colors.accent} onPress={onSpace} />
      </View>
      <PlayerSearch query={query} onQuery={onQuery} onPlayer={onPlayer} onCreate={onNewClient} />
    </View>
  );
}

/* ─────────────────────────── Тариф ─────────────────────────── */

function TariffStep({ player, busy, onOpen }: { player: PlayerSearchItem; busy: boolean; onOpen: (tariff: Tariff | null) => void }) {
  const choice = useTariffChoice(player.clientTier);
  return (
    <View style={styles.stepGap}>
      <PlayerCard player={player} />
      <TariffGrid choice={choice} />
      <PrimaryButton
        title={busy ? 'Открываем…' : 'Открыть счёт'}
        busy={busy}
        disabled={!choice.ready}
        onPress={() => {
          haptic.medium();
          onOpen(choice.selectedTariff);
        }}
      />
    </View>
  );
}

/* ─────────────────────────── Новый клиент ─────────────────────────── */

function ClientStep({
  initialNickname,
  creatingCheck,
  onCreate,
}: {
  initialNickname: string;
  creatingCheck: boolean;
  onCreate: (playerId: string) => void;
}) {
  const [nickname, setNickname] = useState(initialNickname);
  const [tier, setTier] = useState<ClientTier>('guest');

  const newClient = useMutation({
    mutationFn: () => createClient(nickname, tier),
    onSuccess: (playerId) => onCreate(playerId),
    onError: () => haptic.error(),
  });

  const busy = newClient.isPending || creatingCheck;
  const focus = useAutoFocus();
  const canSubmit = nickname.trim().length >= 2 && !busy;
  const submit = () => {
    if (!canSubmit) return;
    haptic.medium();
    newClient.mutate();
  };

  return (
    <View style={styles.stepGap}>
      <GlassCard style={styles.field}>
        <TextInput
          {...focus}
          value={nickname}
          onChangeText={setNickname}
          placeholder="Ник клиента"
          placeholderTextColor={colors.tertiaryLabel}
          selectionColor={colors.accent}
          style={[type.body, styles.fieldInput]}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel="Ник клиента"
        />
      </GlassCard>

      <Host matchContents={{ vertical: true }} style={styles.segment}>
        <Picker
          selection={tier}
          onSelectionChange={(value) => {
            haptic.selection();
            setTier(value as ClientTier);
          }}
          modifiers={[pickerStyle('segmented')]}>
          <SwiftText modifiers={[tag('guest')]}>Гость</SwiftText>
          <SwiftText modifiers={[tag('newbie')]}>Новичок</SwiftText>
          <SwiftText modifiers={[tag('resident')]}>Резидент</SwiftText>
          <SwiftText modifiers={[tag('student')]}>Студент</SwiftText>
        </Picker>
      </Host>

      {newClient.isError && <Text style={[type.footnote, styles.error]}>{newClient.error.message}</Text>}

      <PrimaryButton title={busy ? 'Открываем…' : 'Создать и открыть чек'} busy={busy} disabled={nickname.trim().length < 2} onPress={submit} />
    </View>
  );
}

/* ─────────────────────────── Аренда зоны ─────────────────────────── */

function SpaceStep({ busySpaceId, onPick }: { busySpaceId?: string; onPick: (spaceId: string) => void }) {
  const spaces = useSpaces();
  const checks = useChecks();
  const occupied = new Set((checks.data ?? []).map((c) => c.spaceId).filter(Boolean));
  const list = spaces.data ?? [];

  return (
    <View style={styles.stepGap}>
      {spaces.isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : list.length === 0 ? (
        <Text style={[type.subhead, sheetStyles.secondary, styles.emptyText]}>Активных зон нет — их добавляют в «Тарифах и аренде».</Text>
      ) : (
        <GlassCard>
          <ScrollView style={styles.spaceList} showsVerticalScrollIndicator={false}>
            {list.map((space, index) => {
              const busy = occupied.has(space.id);
              const opening = busySpaceId === space.id;
              return (
                <View key={space.id}>
                  {index > 0 && <View style={[sheetStyles.separator, styles.spaceSeparator]} />}
                  <Pressable
                    disabled={busy || !!busySpaceId}
                    onPress={() => {
                      haptic.medium();
                      onPick(space.id);
                    }}
                    style={({ pressed }) => [styles.spaceRow, pressed && sheetStyles.pressedRow]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy }}>
                    <View style={[styles.spaceIcon, { backgroundColor: busy ? colors.fill : colors.accent }]}>
                      {opening ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <SymbolView name={busy ? 'lock.fill' : 'timer'} size={16} weight="semibold" tintColor={busy ? colors.secondaryLabel : 'white'} />
                      )}
                    </View>
                    <View style={styles.flex}>
                      <Text style={[type.body, busy ? sheetStyles.secondary : sheetStyles.label]} numberOfLines={1}>
                        {space.name}
                      </Text>
                      <Text style={[type.footnote, sheetStyles.secondary]} numberOfLines={1}>
                        {busy ? 'Занята открытым чеком' : (SPACE_TYPE_LABEL[space.type] ?? 'Зона')}
                      </Text>
                    </View>
                    <Text style={[type.subhead, styles.rate]}>{`${formatMoney(space.hourlyRate)}/ч`}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </GlassCard>
      )}
      <Text style={[type.footnote, sheetStyles.secondary, styles.footnote]}>Аренда считается по начатым часам — до оплаты чека.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  step: { gap: space.md },
  stepGap: { gap: space.md },
  flex: { flex: 1 },
  loading: { paddingVertical: space.xxl },
  quickRow: { flexDirection: 'row', gap: 10 },

  field: { paddingHorizontal: space.lg },
  fieldInput: { color: colors.label, minHeight: 48 },
  segment: { alignSelf: 'stretch' },
  error: { color: colors.red, paddingHorizontal: space.xs },

  // Высота — минимальная: с крупным текстом строка зоны растёт, а не обрезает подписи.
  spaceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 64 },
  spaceIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  spaceSeparator: { marginLeft: 58 },
  // В шторке «по содержимому» ScrollView не должен сжиматься: его высота входит в высоту шторки.
  spaceList: { maxHeight: 64 * 5.5, flexShrink: 0 },
  rate: { color: colors.secondaryLabel, fontVariant: ['tabular-nums'] },
  emptyText: { paddingVertical: space.lg, textAlign: 'center' },
  footnote: { paddingHorizontal: space.xs },
});
