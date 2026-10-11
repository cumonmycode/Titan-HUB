import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';

import { BarChart } from '@/components/charts/bar-chart';
import { ShareChart } from '@/components/charts/donut-chart';
import { Avatar, GlassCard, PrimaryButton } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { TaiActionCard, TaiBlock, TaiLink, TaiRoute } from '@/lib/tai-api';
import { openRouteFromTai } from '@/lib/tai-navigate';
import { useTaiStore } from '@/lib/tai-store';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Интерактивные блоки ответа Tai: показатели, график, доли, список, карточка действия,
 * выбор из вариантов и кнопки перехода. Всё нажимается: строки и ссылки открывают экраны
 * приложения, столбцы и доли показывают точные цифры, карточка выполняет действие.
 */
export function TaiBlockView({ block }: { block: TaiBlock }) {
  switch (block.type) {
    case 'metrics':
      return <MetricsBlock block={block} />;
    case 'chart':
      return <ChartBlock block={block} />;
    case 'breakdown':
      return <BreakdownBlock block={block} />;
    case 'list':
      return <ListBlock block={block} />;
    case 'action':
      return <ActionBlock card={block.action} />;
    case 'choice':
      return <ChoiceBlock block={block} />;
    case 'links':
      return <LinksBlock links={block.links} />;
  }
}

function useOpen() {
  const router = useRouter();
  return (to: TaiRoute) => {
    haptic.light();
    openRouteFromTai(router, to);
  };
}

function LinkLine({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.link, pressed && styles.pressed]} accessibilityRole="link">
      <Text style={[type.subhead, styles.accent]} numberOfLines={1}>
        {label}
      </Text>
      <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={colors.accent} />
    </Pressable>
  );
}

function MetricsBlock({ block }: { block: Extract<TaiBlock, { type: 'metrics' }> }) {
  const open = useOpen();
  return (
    <GlassCard style={styles.card}>
      {block.title ? <Text style={[type.footnote, styles.secondary]}>{block.title}</Text> : null}
      <View style={styles.grid}>
        {block.items.map((item) => {
          const good = item.delta === undefined || item.delta === 0 ? null : item.invert ? item.delta < 0 : item.delta > 0;
          return (
            <View key={item.label} style={styles.tile}>
              <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={[type.title3, type.amount, styles.label]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                {item.value}
              </Text>
              {good !== null ? (
                <Text
                  style={[type.caption1, styles.delta, { color: good ? colors.green : colors.red }]}
                >{`${item.delta! > 0 ? '+' : '−'}${Math.abs(item.delta!)}%`}</Text>
              ) : item.hint ? (
                <Text style={[type.caption1, styles.secondary]}>{item.hint}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {block.link ? <LinkLine label={block.link.label} onPress={() => open(block.link!.to)} /> : null}
    </GlassCard>
  );
}

function ChartBlock({ block }: { block: Extract<TaiBlock, { type: 'chart' }> }) {
  const accent = useAccentHex();
  const open = useOpen();
  const [selected, setSelected] = useState<string | null>(null);
  const point = block.points.find((p) => p.key === selected) ?? null;
  const best = block.points.reduce<(typeof block.points)[number] | null>((max, p) => (!max || p.value > max.value ? p : max), null);
  return (
    <GlassCard style={styles.card}>
      <Text style={[type.footnote, styles.secondary]}>{block.title}</Text>
      <View style={styles.selection}>
        {point ? (
          <>
            <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={1}>
              {point.detail ?? `${point.label} · ${block.unit === 'money' ? formatMoney(point.value) : point.value}`}
            </Text>
            {point.to ? <LinkLine label={point.toLabel ?? 'Подробнее'} onPress={() => open(point.to!)} /> : null}
          </>
        ) : (
          <Text style={[type.footnote, styles.tertiary]} numberOfLines={2}>
            {block.caption ?? 'Коснитесь столбца — покажу цифры'}
          </Text>
        )}
      </View>
      <BarChart points={block.points} color={accent} selected={selected} onSelect={setSelected} height={130} highlightKey={best?.key} />
    </GlassCard>
  );
}

function BreakdownBlock({ block }: { block: Extract<TaiBlock, { type: 'breakdown' }> }) {
  const open = useOpen();
  const [selected, setSelected] = useState<string | null>(null);
  const accent = useAccentHex();
  return (
    <GlassCard style={styles.card}>
      <Text style={[type.footnote, styles.secondary]}>{block.title}</Text>
      <ShareChart
        parts={block.parts.map((p) => ({ key: p.key, label: p.label, value: p.value, color: p.color ?? accent }))}
        selected={selected}
        onSelect={setSelected}
        format={(v) => formatMoney(Math.round(v))}
        totalLabel="Всего"
        onOpen={
          block.parts.some((p) => p.to)
            ? (key) => {
                const to = block.parts.find((p) => p.key === key)?.to;
                if (to) open(to);
              }
            : undefined
        }
        openLabel={(part) => `Чеки: ${part.label}`}
      />
    </GlassCard>
  );
}

function ListBlock({ block }: { block: Extract<TaiBlock, { type: 'list' }> }) {
  const open = useOpen();
  return (
    <GlassCard style={styles.card}>
      <Text style={[type.footnote, styles.secondary]}>{block.title}</Text>
      {block.rows.length === 0 ? (
        <Text style={[type.subhead, styles.tertiary]}>{block.empty ?? 'Пусто'}</Text>
      ) : (
        <View>
          {block.rows.map((row, index) => (
            <Pressable
              key={row.id + index}
              disabled={!row.to}
              onPress={() => row.to && open(row.to)}
              style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}
              accessibilityRole={row.to ? 'button' : undefined}
            >
              {row.avatar ? <Avatar name={row.avatar.name} photoUrl={row.avatar.url} size={32} /> : null}
              <View style={styles.flex}>
                <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                  {row.title}
                </Text>
                {row.subtitle ? (
                  <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
                    {row.subtitle}
                  </Text>
                ) : null}
              </View>
              {row.value ? (
                <Text style={[type.subhead, type.amount, styles.label]} numberOfLines={1}>
                  {row.value}
                </Text>
              ) : null}
              {row.to ? <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={colors.tertiaryLabel} /> : null}
            </Pressable>
          ))}
        </View>
      )}
      {block.more ? <LinkLine label={block.more.label} onPress={() => open(block.more!.to)} /> : null}
    </GlassCard>
  );
}

const ACTION_ICON: Record<TaiActionCard['kind'], SFSymbol> = {
  open_check: 'plus.rectangle.on.rectangle',
  add_items: 'cart.badge.plus',
  change_item: 'slider.horizontal.3',
  discount: 'percent',
  cancel_check: 'xmark.bin',
};

function ActionBlock({ card }: { card: TaiActionCard }) {
  const open = useOpen();
  const confirm = useTaiStore((s) => s.confirm);
  const dismiss = useTaiStore((s) => s.dismiss);
  const [busy, setBusy] = useState(false);
  const done = card.status === 'done';
  const failed = card.status === 'failed';
  const cancelled = card.status === 'cancelled';
  const tint = card.destructive ? colors.red : colors.accent;

  return (
    <GlassCard style={[styles.card, cancelled && styles.cancelled]}>
      <View style={styles.actionHeader}>
        <SymbolView
          name={done ? 'checkmark.circle.fill' : failed ? 'exclamationmark.triangle.fill' : ACTION_ICON[card.kind]}
          size={20}
          weight="semibold"
          tintColor={done ? colors.green : failed ? colors.orange : tint}
        />
        <Text style={[type.headline, styles.label, styles.flex]} numberOfLines={2}>
          {card.title}
        </Text>
      </View>
      <View>
        {card.rows.map((row, index) => (
          <View key={`${row.label}-${index}`} style={styles.actionRow}>
            <Text style={[type.subhead, styles.secondary, styles.flex]} numberOfLines={2}>
              {row.label}
            </Text>
            <Text style={[type.subhead, styles.label, styles.actionValue]} numberOfLines={2}>
              {row.value}
            </Text>
          </View>
        ))}
        {card.total ? (
          <View style={[styles.actionRow, styles.totalRow]}>
            <Text style={[type.headline, styles.label, styles.flex]}>Итого</Text>
            <Text style={[type.headline, type.amount, styles.label]}>{card.total}</Text>
          </View>
        ) : null}
      </View>

      {card.status === 'pending' ? (
        <View style={styles.actionButtons}>
          <View style={styles.flex}>
            {card.destructive ? (
              <Pressable
                onPress={async () => {
                  setBusy(true);
                  await confirm(card.id);
                  setBusy(false);
                }}
                disabled={busy}
                style={({ pressed }) => [styles.destructive, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color="white" /> : <Text style={[type.headline, styles.white]}>{card.confirmLabel}</Text>}
              </Pressable>
            ) : (
              <PrimaryButton
                title={card.confirmLabel}
                busy={busy}
                onPress={async () => {
                  setBusy(true);
                  await confirm(card.id);
                  setBusy(false);
                }}
              />
            )}
          </View>
          <Pressable
            onPress={() => dismiss(card.id)}
            disabled={busy}
            hitSlop={8}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={[type.headline, styles.secondary]}>Отмена</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.View entering={FadeIn.duration(200)} style={styles.actionResult}>
          <Text style={[type.subhead, failed ? styles.destructiveText : styles.secondary, styles.flex]}>{cancelled ? 'Отменено' : card.result}</Text>
          {done && card.to ? <LinkLine label={card.to.screen === 'check' ? 'Перейти к чеку' : 'Открыть'} onPress={() => open(card.to!)} /> : null}
        </Animated.View>
      )}
    </GlassCard>
  );
}

function ChoiceBlock({ block }: { block: Extract<TaiBlock, { type: 'choice' }> }) {
  const send = useTaiStore((s) => s.send);
  const busy = useTaiStore((s) => s.busy);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <View style={styles.choice}>
      <Text style={[type.body, styles.label]}>{block.question}</Text>
      {block.options.map((option) => (
        <Pressable
          key={option.label}
          disabled={busy || picked !== null}
          onPress={() => {
            setPicked(option.label);
            void send(option.reply, { display: option.label });
          }}
          accessibilityRole="button"
        >
          <GlassCard interactive style={[styles.option, picked !== null && picked !== option.label && styles.cancelled]}>
            <View style={styles.flex}>
              <Text style={[type.headline, styles.label]}>{option.label}</Text>
              {option.subtitle ? <Text style={[type.footnote, styles.secondary]}>{option.subtitle}</Text> : null}
            </View>
            <SymbolView
              name={picked === option.label ? 'checkmark.circle.fill' : 'chevron.right'}
              size={picked === option.label ? 20 : 12}
              weight="semibold"
              tintColor={picked === option.label ? colors.accent : colors.tertiaryLabel}
            />
          </GlassCard>
        </Pressable>
      ))}
    </View>
  );
}

function LinksBlock({ links }: { links: TaiLink[] }) {
  const open = useOpen();
  return (
    <View style={styles.links}>
      {links.map((link) => (
        <Pressable key={link.label} onPress={() => open(link.to)} accessibilityRole="link">
          <GlassCard interactive style={styles.linkChip}>
            <Text style={[type.subhead, styles.accent, styles.bold]}>{link.label}</Text>
            <SymbolView name="arrow.up.right" size={12} weight="semibold" tintColor={colors.accent} />
          </GlassCard>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  tile: { width: '50%', paddingRight: space.sm, gap: 1 },
  delta: { fontWeight: '600' },
  selection: { minHeight: 40, justifyContent: 'center', gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 9 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  actionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: 5 },
  actionValue: { maxWidth: '60%', textAlign: 'right' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, marginTop: space.xs, paddingTop: space.sm },
  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actionResult: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  destructive: { height: 50, borderRadius: 25, borderCurve: 'continuous', backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  cancel: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  cancelled: { opacity: 0.5 },
  choice: { gap: space.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  linkChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, paddingVertical: 10 },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  accent: { color: colors.accent },
  bold: { fontWeight: '600' },
  white: { color: 'white' },
  destructiveText: { color: colors.red },
  pressed: { opacity: 0.6 },
});
