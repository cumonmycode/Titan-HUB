import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import type { EventRow } from '@/lib/events-api';
import { plural } from '@/lib/format';
import { colors, space, type } from '@/lib/theme';

type EventPrimaryActionProps = {
  event: EventRow;
  /** Игроков в составе миникапа: без них старт закрыт. */
  players: number;
  lineupLoading: boolean;
  /** Ключ выполняемого действия экрана: 'start', 'status-planned'… */
  busy: string | null;
  onStart: () => void;
  onClarified: () => void;
  onOpenCheck: () => void;
};

/**
 * Одно главное действие под шапкой — следующий шаг по статусу: запланировано → начать,
 * требует уточнения → «Всё уточнено», идёт → к чеку. У завершённого и отменённого его нет;
 * остальное — в меню «…».
 */
export function EventPrimaryAction({ event, players, lineupLoading, busy, onStart, onClarified, onOpenCheck }: EventPrimaryActionProps) {
  const isMinicap = event.format === 'minicap';

  if (event.status === 'planned' && isMinicap) {
    const hint =
      players === 0
        ? lineupLoading
          ? 'Загружаем состав…'
          : 'Сначала добавьте игроков в состав'
        : `Откроет ${players} ${plural(players, ['счёт', 'счёта', 'счетов'])} в кассе — нужна открытая смена`;
    return (
      <View style={styles.block}>
        <PrimaryButton
          title={busy === 'start' ? 'Открываем счета…' : 'Начать миникап'}
          icon="play.fill"
          busy={busy === 'start'}
          disabled={players === 0}
          onPress={onStart}
        />
        <Hint text={hint} />
      </View>
    );
  }
  if (event.status === 'planned') {
    return <PrimaryButton title={busy === 'start' ? 'Начинаем…' : 'Начать'} icon="play.fill" busy={busy === 'start'} onPress={onStart} />;
  }
  if (event.status === 'needs_clarification') {
    return <PrimaryButton title="Всё уточнено" icon="checkmark" busy={busy === 'status-planned'} onPress={onClarified} />;
  }
  if (event.status === 'active' && isMinicap) {
    return (
      <View style={styles.block}>
        <PrimaryButton title="Перейти в кассу" icon="rublesign.circle" onPress={onOpenCheck} />
        <Hint text="Счета участников открыты в кассе, взнос уже в каждом." />
      </View>
    );
  }
  if (event.status === 'active') {
    return <PrimaryButton title={event.checkId ? 'Открыть чек' : 'Перейти в кассу'} icon="rublesign.circle" onPress={onOpenCheck} />;
  }
  return null;
}

function Hint({ text }: { text: string }) {
  return <Text style={[type.footnote, styles.hint]}>{text}</Text>;
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  hint: { color: colors.secondaryLabel, textAlign: 'center', paddingHorizontal: space.md },
});
