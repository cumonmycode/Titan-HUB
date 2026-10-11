// Действующий счёт: крупный итог (считает сервер), разбивка, заказы на
// подтверждении, позиции. До открытия счёта — спокойный экран ожидания.
import { Clock3, Hourglass, PartyPopper, Percent, ReceiptText, UtensilsCrossed, type LucideIcon } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { cancelOrder } from '@/data/actions';
import type { CheckView, ClubEvent } from '@/data/types';
import { useRoom } from '@/features/room/use-room';
import { useSessionCheck, useVisit } from '@/features/visit/store';
import { amount, duration, money, plural } from '@/lib/format';
import { Button } from '@/ui/button';
import { Loader } from '@/ui/controls';
import { Glass } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { T } from '@/ui/text';
import { color, space } from '@/ui/tokens';

export function BillView({ portrait }: { portrait: boolean }) {
  const check = useSessionCheck();
  const event = useVisit((s) => s.snapshot?.event ?? null);
  if (!check) {
    return (
      <Glass kind="panel" style={styles.panel}>
        <Loader label="Загружаем счёт…" />
      </Glass>
    );
  }
  const summary = (
    <View style={[styles.summary, portrait && styles.summaryPortrait]}>
      {event ? <EventRow event={event} /> : null}
      <T variant="overline" tone="secondary">Ваш счёт</T>
      <View style={styles.totalRow}>
        <T variant="display" numeric>{amount(check.totals.total)}</T>
        <T variant="title" tone="accent" style={styles.rub}>₽</T>
      </View>
      <Breakdown check={check} />
      <PendingOrders check={check} />
    </View>
  );
  return (
    <Glass kind="panel" style={[styles.panel, !portrait && styles.panelRow]}>
      {portrait ? (
        <ScrollView contentContainerStyle={{ gap: 18 }} showsVerticalScrollIndicator={false}>
          {summary}
          <Items check={check} />
        </ScrollView>
      ) : (
        <>
          <ScrollView style={styles.leftCol} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>{summary}</ScrollView>
          <Items check={check} scroll />
        </>
      )}
    </Glass>
  );
}

function EventRow({ event }: { event: ClubEvent }) {
  const time = event.startTime ? `${event.startTime.slice(0, 5)}${event.endTime ? `–${event.endTime.slice(0, 5)}` : ''}` : '';
  return (
    <View style={styles.event}>
      <Icon as={PartyPopper} size={20} tone={color.accentSoft} />
      <T variant="label" numberOfLines={1} style={{ flex: 1 }}>{event.title || 'Мероприятие'}</T>
      {time ? <T variant="caption" tone="secondary" numeric>{time}</T> : null}
    </View>
  );
}

function Row({ icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.row}>
      <Icon as={icon} size={20} tone={tone ?? color.textTertiary} />
      <T variant="body" numberOfLines={1} style={{ flex: 1, color: tone ?? 'rgba(236,232,245,0.84)', fontSize: 16 }}>{label}</T>
      <T variant="label" numeric style={tone ? { color: tone } : null}>{value}</T>
    </View>
  );
}

function Breakdown({ check }: { check: CheckView }) {
  const t = check.totals;
  if (check.staffComp) {
    return (
      <View style={styles.breakdown}>
        <Row icon={ReceiptText} label="Счёт за счёт заведения" value={money(0)} />
      </View>
    );
  }
  return (
    <View style={styles.breakdown}>
      <Row
        icon={UtensilsCrossed}
        label={check.itemsCount ? `${check.itemsCount} ${plural(check.itemsCount, 'позиция', 'позиции', 'позиций')}` : 'Пока без заказов'}
        value={money(t.items)}
      />
      {check.rental ? (
        <Row icon={Clock3} label={`Аренда · ${duration(check.rental.minutes)}${check.rental.running ? ', идёт' : ''}`} value={money(t.rental)} />
      ) : null}
      {t.event > 0 ? <Row icon={PartyPopper} label="Мероприятие" value={money(t.event)} /> : null}
      {t.discount > 0 ? <Row icon={Percent} label="Скидка" value={`−${money(t.discount)}`} tone={color.green} /> : null}
    </View>
  );
}

function PendingOrders({ check }: { check: CheckView }) {
  if (!check.pendingOrders.length) return null;
  return (
    <View style={{ gap: space.md, marginTop: 'auto' }}>
      {check.pendingOrders.map((order) => (
        <Glass key={order.id} kind="amber" radius={24} style={styles.pending}>
          <View style={styles.pendingHead}>
            <Icon as={Hourglass} size={20} tone={color.amber} />
            <T variant="overline" tone="amber" style={{ flex: 1, letterSpacing: 0.8, fontSize: 13 }}>Ждёт подтверждения</T>
            <Button title="Отменить" size="sm" onPress={() => void cancelOrder(order.id)} />
          </View>
          {order.items.map((it, i) => (
            <View key={i} style={styles.pendingLine}>
              <T variant="body" numberOfLines={1} style={{ flex: 1, fontSize: 16 }}>{it.name} × {it.quantity}</T>
              <T variant="label" numeric>{money(it.sum)}</T>
            </View>
          ))}
        </Glass>
      ))}
    </View>
  );
}

function Items({ check, scroll }: { check: CheckView; scroll?: boolean }) {
  const rows = check.items.map((row, i) => (
    <View key={row.id} style={[styles.item, i < check.items.length - 1 && styles.itemDivider]}>
      <T variant="body" numberOfLines={1} style={{ flex: 1, fontFamily: 'Inter_500Medium' }}>{row.name}</T>
      <T variant="caption" tone="secondary" numeric style={{ width: 52 }}>× {row.quantity}</T>
      <T variant="label" numeric style={styles.itemSum}>{money(row.sum)}</T>
    </View>
  ));
  return (
    <Glass kind="inset" radius={26} style={[styles.items, scroll && { flex: 1 }]}>
      <View style={styles.itemsHead}>
        <T variant="overline" tone="secondary">В счёте</T>
        <T variant="caption" tone="tertiary">обновляется само</T>
      </View>
      {check.items.length ? (
        scroll ? <ScrollView showsVerticalScrollIndicator={false}>{rows}</ScrollView> : rows
      ) : (
        <T variant="body" tone="tertiary" style={{ paddingVertical: 12 }}>Заказы появятся здесь, как только администратор их добавит</T>
      )}
    </Glass>
  );
}

export function WaitingView({ portrait }: { portrait: boolean }) {
  const { configured } = useRoom();
  return (
    <Glass kind="panel" style={[styles.panel, styles.waiting, portrait && styles.waitingPortrait]}>
      <Glass kind="accent" radius={48} style={[styles.waitIcon, { backgroundColor: color.accentTint }]}>
        <Icon as={ReceiptText} size={64} tone={color.accentSoft} stroke={1.4} />
      </Glass>
      <View style={[{ gap: 14, maxWidth: 640 }, portrait && { alignItems: 'center' }]}>
        <T variant="overline" tone="secondary">Ваш счёт</T>
        <T variant="title" style={[{ fontSize: 40, lineHeight: 46 }, portrait && { textAlign: 'center' }]}>Счёт ещё не открыт</T>
        <T variant="body" tone="secondary" style={[{ fontSize: 18, lineHeight: 26 }, portrait && { textAlign: 'center' }]}>
          Администратор откроет его в кассе — он появится здесь сам. А пока можно посмотреть меню{configured ? ' или включить свет' : ''}.
        </T>
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, padding: 28 },
  panelRow: { flexDirection: 'row', gap: 22 },
  leftCol: { width: 384, flexGrow: 0 },
  summary: { gap: 16, flexGrow: 1 },
  summaryPortrait: { flexGrow: 0 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: -8 },
  rub: { fontSize: 34, lineHeight: 50, fontFamily: 'Inter_500Medium' },
  breakdown: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: color.hairline },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  event: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, height: 44, borderRadius: 22,
    backgroundColor: color.accentTint, borderWidth: 1, borderColor: 'rgba(196,181,253,0.28)',
  },
  pending: { padding: 16, gap: 10 },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pendingLine: { flexDirection: 'row', gap: 12 },
  items: { paddingHorizontal: 24, paddingVertical: 18 },
  itemsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  itemDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
  itemSum: { width: 104, textAlign: 'right', fontSize: 17 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 40, paddingHorizontal: 56 },
  waitingPortrait: { flexDirection: 'column', justifyContent: 'center', gap: 28, paddingHorizontal: 32 },
  waitIcon: { width: 152, height: 152, alignItems: 'center', justifyContent: 'center', borderColor: 'rgba(196,181,253,0.30)' },
});
