// «Бонусная программа»: как начисляются и тратятся бонусы, когда сгорают, статус.
// Открывается нажатием на голо-карту. Шторка по высоте содержимого — без прокрутки.
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/components/icon';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Divider, IconTile, Surface } from '@/components/ui';
import { bonus, inDays, longDate, money, plural } from '@/lib/format';
import { useWallet } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';

const RULE_INSET = space.lg + 42 + space.md;

export default function BonusRulesScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet();
  const { data: w } = useWallet();
  const r = w?.bonusRules;

  const rules: { icon: IconName; color: string; title: string; text: string }[] = r ? [
    {
      icon: 'bonus', color: colors.gold, title: `${r.accrualPercent}% бонусами с каждого чека`,
      text: r.minPurchase > 0 ? `За покупки от ${money(r.minPurchase)}. 1 бонус = 1 ₽.` : 'Начисляются после оплаты чека. 1 бонус = 1 ₽.',
    },
    {
      icon: 'sparkles', color: colors.pink, title: 'Оплачивайте бонусами',
      text: r.maxSpendPercent ? `Бонусами можно оплатить до ${r.maxSpendPercent}% чека — скажите об этом на кассе.` : 'Скажите на кассе, что хотите оплатить бонусами.',
    },
    {
      icon: 'pending', color: colors.amber, title: r.expiryDays ? `Сгорают через ${r.expiryDays} ${plural(r.expiryDays, 'день', 'дня', 'дней')}` : 'Не сгорают',
      text: r.expiryDays ? 'Каждое начисление живёт своё время — сначала тратятся те, что сгорят раньше.' : 'Бонусы копятся без срока.',
    },
    {
      icon: 'trophy', color: colors.violetLight, title: 'Статус «Резидент»',
      text: `После ${w?.visitProgress.threshold ?? 10} посещений клуба — больше привилегий и участие в фонде клуба.`,
    },
  ] : [];

  return (
    <View>
      <SheetHeader title="Бонусная программа" onClose={close} />
      <View style={[styles.content, { paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.column}>
          {w ? (
            <Surface tone={colors.violet} style={styles.balance}>
              {w.bonusHidden ? (
                <Text style={type.headline}>Скоро тут появятся бонусы ⭐</Text>
              ) : (
                <>
                  <Text style={type.overline}>На вашем счёте</Text>
                  <Text style={styles.big}>{bonus(w.bonus)} ⭐</Text>
                  {w.bonusExpiring ? (
                    <Text style={styles.expiring}>
                      {bonus(w.bonusExpiring.amount)} сгорят {inDays(w.bonusExpiring.date)} · {longDate(w.bonusExpiring.date)}
                    </Text>
                  ) : null}
                </>
              )}
            </Surface>
          ) : null}

          {rules.length ? (
            <Surface style={styles.rules}>
              {rules.map((rule, i) => (
                <View key={rule.title}>
                  {i > 0 ? <Divider inset={RULE_INSET} /> : null}
                  <View style={styles.rule}>
                    <IconTile name={rule.icon} color={rule.color} size={42} />
                    <View style={styles.flex}>
                      <Text style={type.headline}>{rule.title}</Text>
                      <Text style={styles.ruleText}>{rule.text}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </Surface>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  balance: { alignItems: 'center', paddingVertical: space.xl, paddingHorizontal: space.lg, borderRadius: radius.card },
  big: { color: colors.text, fontSize: 42, fontWeight: '900', fontStyle: 'italic', marginTop: 4, fontVariant: ['tabular-nums'] },
  expiring: { ...StyleSheet.flatten(type.callout), color: colors.amber, marginTop: 6, textAlign: 'center' },
  rules: { marginTop: space.lg, borderRadius: radius.card, overflow: 'hidden' },
  rule: { flexDirection: 'row', gap: space.md, padding: space.lg },
  ruleText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: 3 },
});
