// «Бонусная программа»: баланс крупно, правила — тремя ключевыми цифрами, статус одной строкой.
// Открывается нажатием на карту клуба. Шторка по высоте содержимого — без прокрутки.
// Один акцент — фиолетовый; янтарный только у сгорания, как предупреждение.
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { RollingNumber } from '@/components/rolling-number';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Divider, IconTile, Surface } from '@/components/ui';
import { bonus, calendarDate, inDays, money, plural } from '@/lib/format';
import { useWallet } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { Wallet } from '@/lib/types';

const FIGURE_WIDTH = 76;
const RULE_INSET = space.lg + FIGURE_WIDTH + space.md;

interface Rule {
  figure: string;
  unit?: string;
  title: string;
  text: string;
}

function rulesOf(r: Wallet['bonusRules']): Rule[] {
  const days = r.expiryDays;
  return [
    {
      figure: `${r.accrualPercent}%`,
      title: 'Кэшбэк бонусами',
      text: r.minPurchase > 0 ? `С чеков от ${money(r.minPurchase)}, сразу после оплаты.` : 'С каждого чека, сразу после оплаты.',
    },
    {
      figure: `${r.maxSpendPercent ?? 100}%`,
      title: 'Оплата бонусами',
      text: r.maxSpendPercent ? 'Такую часть чека можно закрыть бонусами — скажите на кассе.' : 'Весь чек можно закрыть бонусами — скажите на кассе.',
    },
    days
      ? { figure: String(days), unit: plural(days, 'день', 'дня', 'дней'), title: 'Живёт начисление', text: 'Первыми тратятся те, что сгорят раньше.' }
      : { figure: '∞', title: 'Без срока', text: 'Бонусы не сгорают.' },
  ];
}

export default function BonusRulesScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const { data: w } = useWallet();

  return (
    <View>
      <SheetHeader title="Бонусная программа" onClose={close} />
      <View style={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
        {w ? (
          <View style={styles.column}>
            <Balance wallet={w} />
            {w.bonusRules.enabled ? (
              <>
                <Text style={styles.section}>Как это работает</Text>
                <Surface style={styles.group}>
                  {rulesOf(w.bonusRules).map((rule, i) => (
                    <View key={rule.title}>
                      {i > 0 ? <Divider inset={RULE_INSET} /> : null}
                      <RuleRow rule={rule} />
                    </View>
                  ))}
                </Surface>
              </>
            ) : null}
            <Status wallet={w} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Balance({ wallet: w }: { wallet: Wallet }) {
  if (w.bonusHidden) {
    return (
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Бонусы скоро появятся</Text>
        <Text style={styles.heroNote}>Клуб включит их — и баланс будет здесь.</Text>
      </View>
    );
  }
  const exp = w.bonusExpiring;
  return (
    <View style={styles.hero} accessible accessibilityLabel={`На счёте ${bonus(w.bonus)} ${plural(w.bonus, 'бонус', 'бонуса', 'бонусов')}`}>
      <Text style={type.overline}>На счёте</Text>
      <RollingNumber value={w.bonus} format={(n) => bonus(Math.round(n))} style={styles.big} maxFontSizeMultiplier={1.2} />
      <Text style={styles.heroNote}>{plural(w.bonus, 'бонус', 'бонуса', 'бонусов')} · 1 бонус = 1 ₽</Text>
      {w.registration === 'pending' ? (
        <View style={[styles.pill, styles.pillViolet]}>
          <Icon name="pending" size={14} color={colors.violetLight} />
          <Text style={styles.pillText}>Начисления — после подтверждения регистрации</Text>
        </View>
      ) : exp ? (
        <View style={[styles.pill, styles.pillAmber]}>
          <Icon name="flame" size={14} color={colors.amber} />
          <Text style={styles.pillText}>
            {bonus(exp.amount)} сгорят {calendarDate(exp.date)}
            <Text style={styles.pillMuted}> · {inDays(exp.date)}</Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  return (
    <View style={styles.rule}>
      <View style={styles.figureBox}>
        <Text style={styles.figure} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{rule.figure}</Text>
        {rule.unit ? <Text style={styles.unit}>{rule.unit}</Text> : null}
      </View>
      <View style={styles.flex}>
        <Text style={type.headline}>{rule.title}</Text>
        <Text style={styles.ruleText}>{rule.text}</Text>
      </View>
    </View>
  );
}

/** Статус «Резидент» одной строкой; подробный прогресс — на главной. */
function Status({ wallet: w }: { wallet: Wallet }) {
  const vp = w.visitProgress;
  const visits = `${vp.visits} ${plural(vp.visits, 'посещение', 'посещения', 'посещений')}`;
  return (
    <Surface style={[styles.group, styles.status]}>
      <IconTile name="trophy" color={colors.violetLight} size={38} />
      <View style={styles.flex}>
        <Text style={type.headline}>{vp.isResident ? `Вы — ${w.tier.label}` : 'Статус «Резидент»'}</Text>
        <Text style={styles.ruleText}>
          {vp.isResident
            ? `${visits} в клубе · привилегии и участие в фонде клуба`
            : `После ${vp.threshold} ${plural(vp.threshold, 'посещения', 'посещений', 'посещений')} — привилегии и фонд клуба`}
        </Text>
      </View>
      {vp.isResident ? null : <Text style={styles.count}>{vp.visits}/{vp.threshold}</Text>}
    </Surface>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  hero: { alignItems: 'center', paddingTop: space.md, paddingBottom: space.xl },
  heroTitle: { ...StyleSheet.flatten(type.heading), textAlign: 'center' },
  big: {
    color: colors.text, fontSize: 64, lineHeight: 72, fontWeight: '800', letterSpacing: -1.5, marginTop: space.xs,
  },
  heroNote: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, textAlign: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.lg,
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  pillAmber: { backgroundColor: colors.amberTint, borderColor: 'rgba(251,191,36,0.24)' },
  pillViolet: { backgroundColor: colors.violetTint, borderColor: colors.borderViolet },
  pillText: { ...StyleSheet.flatten(type.callout), color: colors.textBody, fontWeight: '600', flexShrink: 1 },
  pillMuted: { color: colors.textSecondary, fontWeight: '400' },
  section: { ...StyleSheet.flatten(type.overline), marginBottom: space.sm, marginLeft: space.lg },
  group: { borderRadius: radius.card, overflow: 'hidden' },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, paddingHorizontal: space.lg },
  figureBox: { width: FIGURE_WIDTH },
  figure: { color: colors.violetLight, fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  unit: { ...StyleSheet.flatten(type.caption), color: colors.violetLight, opacity: 0.75, marginTop: -2 },
  ruleText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, marginTop: space.lg },
  count: { ...StyleSheet.flatten(type.headline), color: colors.violetLight, fontVariant: ['tabular-nums'] },
});
