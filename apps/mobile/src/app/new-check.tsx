import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, FadeOut, LayoutAnimationConfig } from 'react-native-reanimated';

import { Text, TextInput } from '@/components/text';
import { GlassCard, PrimaryButton, QuickTile, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { PlayerCard, PlayerSearch, TariffGrid, useTariffChoice } from '@/components/player-picker';
import { useZoneStates, ZoneList } from '@/components/zone-list';
import { useAutoFocus } from '@/lib/auto-focus';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createCheckErrorMessage, openCreatedCheck } from '@/lib/new-check';
import { addEntryTariff, createCheck, createClient, useSpaces, type ClientTier, type PlayerSearchItem, type Tariff } from '@/lib/pos-api';
import { colors, space, type } from '@/lib/theme';

/**
 * Шторка «Новый чек» — по высоте содержимого, как модалка веб-кассы. Шаги сменяют друг
 * друга внутри одной шторки: поиск игрока → тариф, новый клиент или аренда зоны.
 * Поле поиска получает фокус сразу — клавиатура поднимается вместе со шторкой.
 */

type Step =
  | { name: 'search' }
  | { name: 'tariff'; player: PlayerSearchItem }
  | { name: 'client'; nickname: string; spaceId?: string }
  | { name: 'space' }
  | { name: 'spaceClient'; spaceId: string };
type CreateInput = { playerId?: string; spaceId?: string; tariffItemId?: string | null };

const TITLES: Record<Step['name'], string> = {
  search: 'Новый чек',
  tariff: 'Тариф',
  client: 'Новый клиент',
  space: 'Аренда зоны',
  spaceClient: 'Кто в зоне',
};

/** Куда ведёт «Назад»: из выбора клиента для зоны — к зонам, остальное — к поиску. */
function backOf(step: Step): Step | null {
  if (step.name === 'search') return null;
  if (step.name === 'spaceClient') return { name: 'space' };
  if (step.name === 'client' && step.spaceId) return { name: 'spaceClient', spaceId: step.spaceId };
  return { name: 'search' };
}



export default function NewCheckSheet() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'search' });
  const [forward, setForward] = useState(true);
  const [query, setQuery] = useState('');
  // Шторку смахнули или закрыли крестиком, а поле поиска осталось в фокусе — клавиатура
  // висела над кассой без единого поля ввода.
  useEffect(() => () => Keyboard.dismiss(), []);

  const create = useMutation({
    mutationFn: async (input: CreateInput) => {
      const check = await createCheck({ playerId: input.playerId, spaceId: input.spaceId });
      // Как веб: тариф — это позиция меню; её ошибка не отменяет уже открытый чек,
      // но о ней показываем предупреждение (см. addEntryTariff).
      if (input.tariffItemId) await addEntryTariff(check.id, input.tariffItemId);
      return check;
    },
    onSuccess: (check) => {
      Keyboard.dismiss();
      openCreatedCheck(router, check);
    },
    onError: (error) => {
      haptic.error();
      Alert.alert('Чек не открыт', createCheckErrorMessage(error.message));
    },
  });

  const go = (next: Step, back = false) => {
    haptic.selection();
    if (next.name !== 'client' && next.name !== 'spaceClient') Keyboard.dismiss();
    setForward(!back && next.name !== 'search');
    setStep(next);
  };
  const back = backOf(step);

  const busyInput = create.isPending ? create.variables : undefined;
  // Одна шторка — один чек: пока первый открывается, второе нажатие (та же плитка,
  // другой игрок, «Без клиента») раньше создавало ещё один чек.
  const open = (input: CreateInput) => {
    if (create.isPending) return;
    create.mutate(input);
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={TITLES[step.name]}
        onBack={back ? () => go(back, true) : undefined}
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
            onPlayer={(player) => {
              // Сотрудник на чеке — без игрового тарифа: шаг выбора тарифа не нужен.
              if (player.role === 'staff' || player.role === 'owner') {
                haptic.light();
                open({ playerId: player.id });
              } else go({ name: 'tariff', player });
            }}
            onNewClient={(nickname) => go({ name: 'client', nickname })}
            onSpace={() => go({ name: 'space' })}
            onNoClient={() => {
              haptic.light();
              open({});
            }}
            noClientBusy={!!busyInput && !busyInput.playerId && !busyInput.spaceId}
          />
        )}
        {step.name === 'tariff' && (
          <TariffStep
            player={step.player}
            busy={create.isPending}
            onOpen={(tariff) => open({ playerId: step.player.id, tariffItemId: tariff?.itemId })}
          />
        )}
        {step.name === 'client' && (
          <ClientStep initialNickname={step.nickname} onCreate={(playerId) => open({ playerId, spaceId: step.spaceId })} creatingCheck={create.isPending} />
        )}
        {step.name === 'space' && <SpaceStep onPick={(spaceId) => go({ name: 'spaceClient', spaceId })} />}
        {step.name === 'spaceClient' && (
          <SpaceClientStep
            spaceId={step.spaceId}
            query={query}
            onQuery={setQuery}
            busy={create.isPending}
            noClientBusy={!!busyInput && !busyInput.playerId && !!busyInput.spaceId}
            onPlayer={(player) => open({ playerId: player.id, spaceId: step.spaceId })}
            onNewClient={(nickname) => go({ name: 'client', nickname, spaceId: step.spaceId })}
            onNoClient={() => {
              haptic.light();
              open({ spaceId: step.spaceId });
            }}
          />
        )}
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

function SpaceStep({ onPick }: { onPick: (spaceId: string) => void }) {
  const { zones, loading } = useZoneStates();
  return (
    <View style={styles.stepGap}>
      <ZoneList zones={zones} loading={loading} onPick={onPick} />
      <Text style={[type.footnote, sheetStyles.secondary, styles.footnote]}>Аренда считается по начатым часам — до оплаты чека.</Text>
    </View>
  );
}

/**
 * После зоны — кто в ней: клиент из базы, новый или без клиента. Аренда с клиентом сразу
 * даёт ему его скидки и бонусы; раньше чек аренды открывался только без клиента.
 */
function SpaceClientStep({
  spaceId,
  query,
  onQuery,
  busy,
  noClientBusy,
  onPlayer,
  onNewClient,
  onNoClient,
}: {
  spaceId: string;
  query: string;
  onQuery: (q: string) => void;
  busy: boolean;
  noClientBusy: boolean;
  onPlayer: (player: PlayerSearchItem) => void;
  onNewClient: (nickname: string) => void;
  onNoClient: () => void;
}) {
  const spaces = useSpaces();
  const zone = spaces.data?.find((s) => s.id === spaceId);
  return (
    <View style={styles.stepGap}>
      {zone ? (
        <Text style={[type.subhead, sheetStyles.secondary, styles.footnote]}>{`${zone.name} · ${formatMoney(zone.hourlyRate)}/ч`}</Text>
      ) : null}
      <View style={styles.quickRow}>
        <QuickTile icon="person.crop.circle.badge.questionmark" title="Без клиента" tint={colors.gray} busy={noClientBusy} onPress={onNoClient} />
        <QuickTile icon="person.badge.plus" title="Новый клиент" tint={colors.blue} onPress={() => onNewClient(query.trim())} />
      </View>
      <PlayerSearch query={query} onQuery={onQuery} onPlayer={(player) => !busy && onPlayer(player)} onCreate={onNewClient} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  step: { gap: space.md },
  stepGap: { gap: space.md },
  quickRow: { flexDirection: 'row', gap: 10 },

  field: { paddingHorizontal: space.lg },
  fieldInput: { color: colors.label, minHeight: 48 },
  segment: { alignSelf: 'stretch' },
  error: { color: colors.red, paddingHorizontal: space.xs },

  footnote: { paddingHorizontal: space.xs },
});
