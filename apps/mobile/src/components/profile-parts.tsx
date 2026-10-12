import { SymbolView } from 'expo-symbols';
import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Avatar } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

/**
 * Карточка человека (клиент, заказчик) в духе «Контактов» iOS: крупная шапка, кнопки связи
 * равной ширины, плитки сумм и сгруппированные строки «подпись — значение». Всё на RN:
 * длинное значение переносится в своей колонке, а не выдавливает подпись и кнопки.
 */

export function ProfileHeader({ name, photoUrl, title, subtitle, chip }: { name: string; photoUrl?: string | null; title: string; subtitle?: string | null; chip?: { text: string; color: string } | null }) {
  return (
    <View style={styles.header}>
      <Avatar name={name} photoUrl={photoUrl} size={92} />
      <Text style={[type.title1, styles.label, styles.center]} numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[type.subhead, styles.secondary, styles.center]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {chip ? (
        <View style={[styles.chip, { backgroundColor: `${chip.color}22` }]}>
          <Text style={[type.footnote, styles.chipText, { color: chip.color }]}>{chip.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

export type ContactAction = { icon: SFSymbol; label: string; onPress?: () => void };

/** Кнопки связи одной ширины; недоступная — приглушена и не нажимается. */
export function ContactButtons({ items }: { items: ContactAction[] }) {
  return (
    <View style={styles.contacts}>
      {items.map((item) => {
        const tint = item.onPress ? colors.accent : colors.tertiaryLabel;
        return (
          <Pressable
            key={item.label}
            disabled={!item.onPress}
            onPress={() => {
              haptic.light();
              item.onPress?.();
            }}
            style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !item.onPress }}
          >
            <SymbolView name={item.icon} size={20} tintColor={tint} />
            <Text style={[type.caption1, styles.contactLabel, { color: tint }]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Плитка суммы: подпись цветом, крупная цифра, подсказка, что будет по нажатию. */
export function StatTile({ label, value, color, hint, onPress }: { label: string; value: string; color: ColorValue; hint?: string; onPress?: () => void }) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        haptic.light();
        onPress?.();
      }}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={[type.footnote, styles.tileLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.title2, type.amount, styles.label]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Группа строк с заголовком и подписью снизу; между строками — тонкие разделители. */
export function Card({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      {title ? <Text style={[type.footnote, styles.groupTitle]}>{title}</Text> : null}
      <View style={styles.card}>
        {rows.map((row, index) => (
          <View key={row.key ?? index} style={index > 0 ? styles.separator : undefined}>
            {row}
          </View>
        ))}
      </View>
      {footer ? <Text style={[type.footnote, styles.footer]}>{footer}</Text> : null}
    </View>
  );
}

/** Строка «подпись — значение»: подпись не сжимается, значение переносится справа. */
export function InfoRow({ label, value, muted, icon, iconColor, onPress, chevron }: { label: string; value?: string | null; muted?: boolean; icon?: SFSymbol; iconColor?: string; onPress?: () => void; chevron?: boolean }) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        haptic.selection();
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.rowPressed]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: iconColor ?? colors.gray }]}>
          <SymbolView name={icon} size={14} tintColor="white" />
        </View>
      ) : null}
      <Text style={[type.body, styles.label, styles.rowLabel]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={[type.body, muted ? styles.tertiary : onPress ? styles.accent : styles.secondary, styles.rowValue]} numberOfLines={2}>
          {value}
        </Text>
      ) : (
        <View style={styles.flex} />
      )}
      {chevron ? <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} /> : null}
    </Pressable>
  );
}

/** Строка движения: значок, что это и когда, сумма со знаком. */
export function MoveRow({ icon, color, title, subtitle, amount, amountColor, onPress }: { icon: SFSymbol; color: string; title: string; subtitle: string; amount: string; amountColor?: ColorValue; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && onPress && styles.rowPressed]} accessibilityRole={onPress ? 'button' : undefined}>
      <SymbolView name={icon} size={26} tintColor={color} />
      <View style={styles.flex}>
        <Text style={[type.body, styles.label]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text style={[type.body, type.amount, { color: amountColor ?? colors.label }]} numberOfLines={1}>
        {amount}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: 4, paddingTop: space.sm, paddingBottom: space.xs },
  center: { textAlign: 'center' },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  accent: { color: colors.accent },
  flex: { flex: 1, minWidth: 0 },
  chip: { marginTop: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  chipText: { fontWeight: '600' },
  contacts: { flexDirection: 'row', gap: space.sm },
  contact: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card },
  contactLabel: { fontWeight: '500' },
  pressed: { opacity: 0.6 },
  tile: { flex: 1, minWidth: 0, gap: 2, padding: space.md, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
  tileLabel: { fontWeight: '600' },
  group: { gap: 6 },
  groupTitle: { color: colors.secondaryLabel, paddingHorizontal: space.lg, textTransform: 'uppercase' },
  card: { backgroundColor: colors.card, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, marginLeft: space.lg },
  footer: { color: colors.secondaryLabel, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 46, paddingHorizontal: space.lg, paddingVertical: 10 },
  rowPressed: { backgroundColor: colors.fill },
  rowIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flexShrink: 0, maxWidth: '50%' },
  rowValue: { flex: 1, minWidth: 0, textAlign: 'right' },
});
