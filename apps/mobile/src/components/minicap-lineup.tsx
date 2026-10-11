import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { Avatar, GlassCard, sheetStyles } from '@/components/new-check-parts';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import {
  eventErrorMessage,
  MINICAP_MAX_PLAYERS,
  participantBill,
  removeParticipant,
  setParticipantPrepaid,
  type EventParticipant,
  type EventParticipantsQuery,
  type EventRow,
} from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { TIER_LABEL } from '@/lib/pos-api';
import { colors, space, type } from '@/lib/theme';

const rowLayout = LinearTransition.springify().damping(22).stiffness(220);
const errorText = (error: unknown) => eventErrorMessage(error instanceof Error ? error.message : String(error));

/**
 * Состав миникапа: игроки с отметкой «Оплатил» и суммой их счёта в кассе, судья отдельно.
 * Строка идущего миникапа открывает счёт участника; свайп влево убирает из состава.
 */
export function MinicapLineup({ event, lineup }: { event: EventRow; lineup: EventParticipantsQuery }) {
  const router = useRouter();
  const list = lineup.data ?? [];
  const players = list.filter((p) => p.role === 'player');
  const judge = list.find((p) => p.role === 'judge') ?? null;
  const editable = event.status !== 'completed' && event.status !== 'cancelled';
  const fee = toNumber(event.participationFee);
  const prepaidCount = players.filter((p) => p.prepaid).length;

  const openPicker = (role: 'player' | 'judge') => {
    haptic.light();
    router.push({ pathname: '/events/participants', params: { eventId: event.id, role } });
  };

  const togglePrepaid = (p: EventParticipant) => {
    haptic.selection();
    setParticipantPrepaid(event.id, p.id, !p.prepaid).catch((error: unknown) => {
      haptic.error();
      Alert.alert('Отметка не сохранилась', errorText(error));
    });
  };

  const remove = (p: EventParticipant) =>
    Alert.alert(
      `Убрать ${p.nickname ?? 'участника'} из состава?`,
      p.checkStatus === 'open' ? 'Его пустой счёт в кассе отменится. Если в счёте уже есть позиции — сначала закройте его.' : undefined,
      [
        { text: 'Назад', style: 'cancel' },
        {
          text: 'Убрать',
          style: 'destructive',
          onPress: () =>
            removeParticipant(event.id, p.id)
              .then(() => haptic.success())
              .catch((error: unknown) => {
                haptic.error();
                Alert.alert('Участник остался в составе', errorText(error));
              }),
        },
      ],
    );

  const openCheck = (p: EventParticipant) => {
    if (!p.checkId) return;
    haptic.light();
    router.push({ pathname: '/pos/[checkId]', params: { checkId: p.checkId } });
  };

  const renderRow = (p: EventParticipant, index: number) => (
    <Animated.View key={p.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
      {index > 0 && <View style={[sheetStyles.separator, styles.separator]} />}
      <SwipeToDelete enabled={editable} label="Убрать" onDelete={() => remove(p)}>
        <ParticipantRow
          participant={p}
          eventStatus={event.status}
          showPrepaid={p.role === 'player' && fee > 0}
          prepaidEditable={editable && p.checkStatus !== 'closed'}
          onTogglePrepaid={() => togglePrepaid(p)}
          onOpenCheck={p.checkStatus === 'open' ? () => openCheck(p) : undefined}
        />
      </SwipeToDelete>
    </Animated.View>
  );

  return (
    <LayoutAnimationConfig skipEntering>
      <View style={styles.group}>
        <View style={styles.header}>
          <Text style={[type.footnote, sheetStyles.sectionTitle, styles.flex]}>{`ИГРОКИ · ${players.length}/${MINICAP_MAX_PLAYERS}`}</Text>
          {fee > 0 && players.length > 0 && <Text style={[type.footnote, styles.headerNote]}>{`оплатили заранее ${prepaidCount} из ${players.length}`}</Text>}
        </View>
        <GlassCard>
          {lineup.isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : players.length === 0 ? (
            <View style={styles.empty}>
              <SymbolView name="person.3" size={26} tintColor={colors.tertiaryLabel} />
              <Text style={[type.subhead, sheetStyles.secondary]}>{editable ? 'Состав пока пуст' : 'Игроков не было'}</Text>
            </View>
          ) : (
            players.map(renderRow)
          )}
          {editable && players.length < MINICAP_MAX_PLAYERS && (
            <>
              <View style={[sheetStyles.separator, players.length > 0 && styles.separator]} />
              <AddRow icon="person.badge.plus" title={players.length === 0 ? 'Добавить игроков' : 'Добавить игрока'} onPress={() => openPicker('player')} />
            </>
          )}
        </GlassCard>
      </View>

      <View style={styles.group}>
        <Text style={[type.footnote, sheetStyles.sectionTitle]}>СУДЬЯ</Text>
        <GlassCard>
          {judge ? (
            renderRow(judge, 0)
          ) : editable ? (
            <AddRow icon="person.badge.shield.checkmark" title="Назначить судью" onPress={() => openPicker('judge')} />
          ) : (
            <View style={styles.empty}>
              <Text style={[type.subhead, sheetStyles.secondary]}>Судья не был назначен</Text>
            </View>
          )}
        </GlassCard>
      </View>
    </LayoutAnimationConfig>
  );
}

function ParticipantRow({
  participant: p,
  eventStatus,
  showPrepaid,
  prepaidEditable,
  onTogglePrepaid,
  onOpenCheck,
}: {
  participant: EventParticipant;
  eventStatus: EventRow['status'];
  showPrepaid: boolean;
  prepaidEditable: boolean;
  onTogglePrepaid: () => void;
  onOpenCheck?: () => void;
}) {
  const bill = participantBill(p);
  const tier = p.clientTier ? (TIER_LABEL[p.clientTier] ?? p.clientTier) : null;
  const billText =
    bill.state === 'open'
      ? bill.amount > 0
        ? `к оплате ${formatMoney(bill.amount)}`
        : 'всё оплачено заранее'
      : bill.state === 'closed'
        ? `оплачен · ${formatMoney(bill.amount)}`
        : bill.state === 'cancelled'
          ? 'счёт отменён'
          : eventStatus === 'active'
            ? 'счёт не открыт — нет смены'
            : null;

  return (
    <Pressable
      onPress={onOpenCheck}
      disabled={!onOpenCheck}
      style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]}
      accessibilityRole={onOpenCheck ? 'button' : undefined}
      accessibilityHint={onOpenCheck ? 'Открывает счёт участника в кассе' : undefined}>
      <Avatar name={p.nickname ?? '··'} size={40} />
      <View style={styles.flex}>
        <Text style={[type.body, sheetStyles.label]} numberOfLines={1}>
          {p.nickname ?? 'Игрок'}
        </Text>
        <Text style={[type.footnote, bill.state === 'closed' ? styles.paid : sheetStyles.secondary]} numberOfLines={1}>
          {[p.role === 'judge' ? 'судья, без взноса' : tier, billText].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {showPrepaid && (
        <Pressable
          onPress={onTogglePrepaid}
          disabled={!prepaidEditable}
          hitSlop={8}
          style={({ pressed }) => [styles.prepaid, p.prepaid && styles.prepaidOn, pressed && styles.pressed]}
          accessibilityRole="switch"
          accessibilityState={{ checked: p.prepaid, disabled: !prepaidEditable }}
          accessibilityLabel="Оплатил взнос заранее">
          <SymbolView name={p.prepaid ? 'checkmark.circle.fill' : 'circle'} size={15} weight="semibold" tintColor={p.prepaid ? colors.green : colors.tertiaryLabel} />
          <Text style={[type.caption1, p.prepaid ? styles.prepaidTextOn : styles.prepaidText]}>Оплатил</Text>
        </Pressable>
      )}
      {onOpenCheck && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />}
    </Pressable>
  );
}

function AddRow({ icon, title, onPress }: { icon: SFSymbol; title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && sheetStyles.pressedRow]} accessibilityRole="button">
      <View style={styles.addIcon}>
        <SymbolView name={icon} size={18} weight="semibold" tintColor={colors.accent} />
      </View>
      <Text style={[type.body, styles.addText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  headerNote: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  loading: { paddingVertical: space.xl },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  separator: { marginLeft: 68 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 60 },
  paid: { color: colors.green, fontWeight: '600' },
  prepaid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  prepaidOn: { backgroundColor: 'rgba(52,199,89,0.18)' },
  prepaidText: { color: colors.secondaryLabel, fontWeight: '600' },
  prepaidTextOn: { color: colors.green, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  addIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  addText: { color: colors.accent, fontWeight: '600' },
});
