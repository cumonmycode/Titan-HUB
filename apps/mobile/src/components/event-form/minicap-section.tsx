import { Host, Toggle } from '@expo/ui/swift-ui';
import { tint } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';

import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseAmount } from '@/lib/shift-api';
import { colors, space, useAccentHex } from '@/lib/theme';

import { formStyles } from './parts';

/** Миникап — турнир в клубе: своё название, взнос игроков и расходы турнира вместо оплаты. */

const layout = LinearTransition.springify().damping(24).stiffness(220);

/** Расход турнира: тумблер и сумма. Выключенный уходит нулём — сервер удаляет его из расходов клуба. */
export type Cost = { on: boolean; text: string };

export const costFrom = (value: string | null | undefined): Cost => {
  const amount = toNumber(value);
  return { on: amount > 0, text: amount > 0 ? String(amount) : '' };
};

export const costAmount = (cost: Cost) => (cost.on ? (parseAmount(cost.text) ?? 0) : 0);

export type MinicapCosts = { prize: Cost; lunch: Cost; other: Cost };

export function MinicapTitle({ value, onChange, autoFocus }: { value: string; onChange: (value: string) => void; autoFocus: boolean }) {
  return (
    <FormSection title="НАЗВАНИЕ МИНИКАПА">
      <GlassCard style={formStyles.card}>
        <FormField icon="trophy" value={value} onChange={onChange} placeholder="Например, Кубок сентября" autoCapitalize="sentences" autoFocus={autoFocus} />
      </GlassCard>
    </FormSection>
  );
}

export function MinicapMoney({
  fee,
  onFee,
  costs,
  onCosts,
}: {
  fee: string;
  onFee: (value: string) => void;
  costs: MinicapCosts;
  onCosts: (costs: MinicapCosts) => void;
}) {
  const accent = useAccentHex();
  const total = costAmount(costs.prize) + costAmount(costs.lunch) + costAmount(costs.other);
  const set = (key: keyof MinicapCosts) => (cost: Cost) => onCosts({ ...costs, [key]: cost });
  return (
    <>
      <FormSection title="ВЗНОС" footer="Ложится в счёт каждого игрока при старте. Судья играет без взноса.">
        <GlassCard style={formStyles.card}>
          <FormField icon="rublesign" value={fee} onChange={onFee} placeholder="Стоимость участия" keyboardType="decimal-pad" suffix="₽" />
        </GlassCard>
      </FormSection>
      <FormSection
        title="РАСХОДЫ ТУРНИРА"
        footer={total > 0 ? `Итого ${formatMoney(total)} — попадут в расходы клуба датой миникапа.` : 'Попадут в расходы клуба датой миникапа.'}>
        <GlassCard style={formStyles.card}>
          <CostRow icon="gift" label="Призовой фонд" cost={costs.prize} onChange={set('prize')} accent={accent} />
          <View style={sheetStyles.separator} />
          <CostRow icon="fork.knife" label="Обед" cost={costs.lunch} onChange={set('lunch')} accent={accent} />
          <View style={sheetStyles.separator} />
          <CostRow icon="ellipsis.circle" label="Иные расходы" cost={costs.other} onChange={set('other')} accent={accent} />
        </GlassCard>
      </FormSection>
    </>
  );
}

function CostRow({ icon, label, cost, onChange, accent }: { icon: SFSymbol; label: string; cost: Cost; onChange: (cost: Cost) => void; accent: string }) {
  return (
    <Animated.View layout={layout}>
      <View style={styles.costTop}>
        <SymbolView name={icon} size={16} weight="medium" tintColor={colors.secondaryLabel} />
        <Host matchContents={{ vertical: true }} style={formStyles.flex} seedColor={accent}>
          <Toggle
            label={label}
            isOn={cost.on}
            onIsOnChange={(on) => {
              haptic.selection();
              onChange({ ...cost, on });
            }}
            modifiers={[tint(accent)]}
          />
        </Host>
      </View>
      {cost.on && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={styles.costAmount}>
          <FormField
            icon="rublesign"
            value={cost.text}
            onChange={(text) => onChange({ ...cost, text })}
            placeholder={`Сумма, ${label.toLowerCase()}`}
            keyboardType="decimal-pad"
            suffix="₽"
            autoFocus={!cost.text}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  costTop: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50 },
  costAmount: { paddingLeft: 28 },
});
