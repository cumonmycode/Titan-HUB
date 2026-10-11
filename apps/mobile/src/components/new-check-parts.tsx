import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, radius, space, type } from '@/lib/theme';

/**
 * Стеклянный набор для шторок (iOS 26): сама шторка — системное Liquid Glass, внутри —
 * стеклянные карточки, плитки, чипсы и кнопки с системными анимациями касания.
 */

/** Карточка из стекла; `interactive` — отклик на касание (подъём и блик под пальцем). */
export function GlassCard({
  children,
  style,
  tint,
  interactive,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: ColorValue;
  interactive?: boolean;
}) {
  return (
    <GlassView isInteractive={interactive} tintColor={tint} style={[styles.glassCard, style]}>
      {children}
    </GlassView>
  );
}

export function SheetHeader({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{onBack && <CircleButton icon="chevron.left" label="Назад" onPress={onBack} />}</View>
      <Text style={[type.headline, styles.headerTitle]} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        <CircleButton icon="xmark" label="Закрыть" onPress={onClose} />
      </View>
    </View>
  );
}

export function CircleButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <GlassView isInteractive style={styles.circle}>
        <SymbolView name={icon} size={15} weight="semibold" tintColor={colors.label} />
      </GlassView>
    </Pressable>
  );
}

/** Плитка быстрого действия: цветной значок над подписью, стекло с откликом. */
export function QuickTile({
  icon,
  title,
  tint,
  busy,
  onPress,
}: {
  icon: SFSymbol;
  title: string;
  tint: ColorValue;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={styles.flex} accessibilityRole="button" accessibilityLabel={title}>
      <GlassView isInteractive style={styles.quickTile}>
        <View style={[styles.quickIcon, { backgroundColor: tint }]}>
          {busy ? <ActivityIndicator color="white" /> : <SymbolView name={icon} size={19} weight="semibold" tintColor="white" />}
        </View>
        <Text style={[type.footnote, styles.quickTitle]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
          {title}
        </Text>
      </GlassView>
    </Pressable>
  );
}

/** Капсула-переключатель из стекла; активная окрашивается. */
export function GlassChip({
  label,
  active,
  onPress,
  icon,
  tint = colors.accent,
  style,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: SFSymbol;
  tint?: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <GlassView isInteractive tintColor={active ? tint : undefined} style={styles.chip}>
        {icon && <SymbolView name={icon} size={14} weight="semibold" tintColor={active ? 'white' : tint} />}
        <Text style={[type.subhead, active ? styles.chipTextActive : styles.chipText]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
          {label}
        </Text>
      </GlassView>
    </Pressable>
  );
}

export function Avatar({ name, photoUrl, size }: { name: string; photoUrl?: string | null; size: number }) {
  // Фото клуба лежит в его хранилище: если оно недоступно, показываем инициалы, а не
  // пустой круг. Помним именно битую ссылку — новое фото пробуем загрузить снова.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl && photoUrl !== brokenUrl) {
    return <Image source={{ uri: photoUrl }} style={round} contentFit="cover" transition={150} onError={() => setBrokenUrl(photoUrl)} accessibilityLabel={name} />;
  }
  return (
    <View style={[styles.avatar, round]}>
      {/* Инициалы вписаны в круг фиксированного размера — с крупным текстом они бы вылезли за него. */}
      <Text allowFontScaling={false} style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>
        {name.slice(0, 2).toUpperCase()}
      </Text>
    </View>
  );
}

/** Депозит, долг и бонусы игрока — маленькие цветные капсулы, как в веб-кассе. */
export function BalanceChips({ balance, bonusPoints }: { balance: string | number; bonusPoints: string | number }) {
  const b = toNumber(balance);
  const bonus = Math.floor(toNumber(bonusPoints));
  if (b === 0 && bonus <= 0) return null;
  return (
    <View style={styles.chips}>
      {b !== 0 && <Badge color={b > 0 ? '#0891B2' : '#E11D48'} text={b > 0 ? formatMoney(b) : `долг ${formatMoney(-b)}`} />}
      {bonus > 0 && <Badge color="#D97706" text={`★ ${bonus}`} />}
    </View>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}24` }]}>
      <Text style={[type.caption1, styles.badgeText, { color }]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {text}
      </Text>
    </View>
  );
}

/** Главная кнопка шторки — окрашенное стекло (как `glassProminent`). */
export function PrimaryButton({
  title,
  onPress,
  busy,
  disabled,
  icon,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: SFSymbol;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}>
      <GlassView isInteractive tintColor={disabled ? undefined : colors.accent} style={styles.primary}>
        {busy ? (
          <ActivityIndicator color="white" />
        ) : (
          icon && <SymbolView name={icon} size={17} weight="semibold" tintColor={disabled ? colors.tertiaryLabel : 'white'} />
        )}
        <Text style={[type.headline, styles.primaryLabel, disabled ? styles.primaryTextDisabled : styles.primaryText]}>{title}</Text>
      </GlassView>
    </Pressable>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;

/**
 * Цифровая клавиатура из стекла — как ввод суммы в Apple Pay: сумма крупно, клавиши
 * под пальцем, системная клавиатура не закрывает шторку.
 */
export function AmountKeypad({ value, onChange, maxLength = 9, allowDecimal = true }: { value: string; onChange: (next: string) => void; maxLength?: number; allowDecimal?: boolean }) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === '⌫') {
      if (!value) return;
      haptic.light();
      onChange(value.slice(0, -1));
      return;
    }
    if (key === ',') {
      if (!allowDecimal || value.includes(',')) return;
      haptic.selection();
      onChange(value ? `${value},` : '0,');
      return;
    }
    const [, fraction] = value.split(',');
    if (fraction !== undefined && fraction.length >= 2) return;
    if (value.replace(',', '').length >= maxLength) return;
    haptic.selection();
    onChange(value === '0' ? key : value + key);
  };

  return (
    <View style={styles.keypad}>
      {KEYS.map((key) => {
        const hidden = key === ',' && !allowDecimal;
        return (
          <Pressable
            key={key}
            disabled={hidden}
            onPress={() => press(key)}
            onLongPress={key === '⌫' ? () => onChange('') : undefined}
            style={[styles.keyCell, hidden && styles.hidden]}
            accessibilityRole="button"
            accessibilityLabel={key === '⌫' ? 'Стереть' : key === ',' ? 'Запятая' : key}>
            <GlassView isInteractive style={styles.key}>
              {key === '⌫' ? (
                <SymbolView name="delete.left" size={22} tintColor={colors.label} />
              ) : (
                <Text style={[styles.keyText, type.amount]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                  {key}
                </Text>
              )}
            </GlassView>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Опасное действие — как «Выйти» в «Настройках» iOS: отдельная строка-карточка с
 * красной подписью по центру, а не голая ссылка под формой.
 */
export function DangerRow({ title, icon, busy, onPress }: { title: string; icon?: SFSymbol; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ busy: !!busy }}>
      <GlassView isInteractive style={styles.dangerRow}>
        {busy ? (
          <ActivityIndicator color={colors.red} />
        ) : (
          <>
            {icon && <SymbolView name={icon} size={17} weight="semibold" tintColor={colors.red} />}
            <Text style={[type.body, styles.dangerText]}>{title}</Text>
          </>
        )}
      </GlassView>
    </Pressable>
  );
}

export const sheetStyles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  label: { color: colors.label },
  pressedRow: { backgroundColor: colors.fill },
  sectionTitle: { color: colors.secondaryLabel, paddingHorizontal: space.xs, fontWeight: '600', letterSpacing: 0.4 },
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  glassCard: { borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  headerSide: { width: 44, alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.label },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // flex: плитки одного ряда равной высоты, даже если подпись одной перенеслась на две строки.
  quickTile: {
    flex: 1,
    alignItems: 'center',
    gap: space.sm,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: space.xs,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  quickIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quickTitle: { color: colors.label, fontWeight: '600', textAlign: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 19,
  },
  chipText: { color: colors.label, fontWeight: '600' },
  chipTextActive: { color: 'white', fontWeight: '600' },
  avatar: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '600', fontFamily: 'ui-rounded' },
  chips: { flexDirection: 'row', gap: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  badgeText: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  dangerRow: {
    minHeight: 54,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  dangerText: { color: colors.red, fontWeight: '600' },
  // Высота — минимальная: с крупным текстом кнопка растёт, а не обрезает подпись.
  primary: {
    minHeight: 54,
    paddingVertical: 10,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  primaryLabel: { flexShrink: 1, textAlign: 'center' },
  primaryText: { color: 'white' },
  primaryTextDisabled: { color: colors.tertiaryLabel },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, justifyContent: 'space-between' },
  keyCell: { width: '31.5%' },
  key: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 26, color: colors.label },
  hidden: { opacity: 0 },
});
