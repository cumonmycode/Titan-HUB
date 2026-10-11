// Три действия гостя — у каждого одно место: Меню · Администратор · Оплатить.
// Без счёта — только меню (просмотр) и администратор.
import { Bell, QrCode, UtensilsCrossed, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { type GuestLayer, useSessionCheck, useVisit } from '@/features/visit/store';
import { CountBadge } from '@/ui/controls';
import { glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Press } from '@/ui/press';
import { T } from '@/ui/text';
import { color, radius } from '@/ui/tokens';

function Action({
  icon, title, caption, layer, primary, badge = 0, disabled, compact,
}: { icon: LucideIcon; title: string; caption: string; layer: GuestLayer; primary?: boolean; badge?: number; disabled?: boolean; compact: boolean }) {
  return (
    <Press
      onPress={() => useVisit.getState().open(layer)}
      disabled={disabled}
      accessibilityLabel={title}
      style={[styles.action, compact && styles.actionCompact, glassStyle(primary ? 'accent' : 'control', radius.pill)]}
    >
      <View style={[styles.iconWrap, compact && styles.iconCompact, { backgroundColor: primary ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)' }]}>
        <Icon as={icon} size={compact ? 22 : 26} tone={primary ? color.onAccent : color.text} />
        <CountBadge count={badge} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <T variant="subheading" numberOfLines={1} style={[{ fontSize: compact ? 17 : 20 }, primary && { color: color.onAccent }]}>{title}</T>
        {compact ? null : <T variant="small" numberOfLines={1} style={{ color: primary ? 'rgba(255,255,255,0.82)' : color.textSecondary }}>{caption}</T>}
      </View>
    </Press>
  );
}

export function ActionBar({ compact }: { compact: boolean }) {
  const inSession = useVisit((s) => s.phase.kind === 'session');
  const check = useSessionCheck();
  const total = check?.totals.total ?? 0;
  return (
    <View style={styles.bar}>
      <Action icon={UtensilsCrossed} title="Меню" caption={inSession ? 'Заказ прямо отсюда' : 'Посмотрите, что у нас есть'} layer="menu" primary compact={compact} />
      <Action icon={Bell} title="Администратор" caption={inSession ? 'Позвать или написать' : 'Позвать к столу'} layer="admin" badge={check?.unread ?? 0} compact={compact} />
      {inSession ? <Action icon={QrCode} title="Оплатить" caption="СБП или счёт на стол" layer="pay" disabled={total <= 0} compact={compact} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 14, height: 84 },
  action: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 14, paddingRight: 20 },
  actionCompact: { gap: 10, paddingLeft: 10, paddingRight: 14 },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  iconCompact: { width: 48, height: 48, borderRadius: 24 },
});
