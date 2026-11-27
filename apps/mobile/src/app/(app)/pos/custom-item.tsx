import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard, PrimaryButton, SheetHeader } from '@/components/new-check-parts';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { addCustomItem } from '@/lib/pos-api';
import { parseAmount } from '@/lib/shift-api';
import { space } from '@/lib/theme';

const NAME_MAX = 120;
const PRICE_MAX = 1_000_000;

/**
 * Свободная позиция «Другое»: кассир вписывает название и сумму. Нужна для денег,
 * которые клуб заплатил за гостя (еда из другого заведения), — гость возвращает их по
 * чеку. Склад не списывается, скидки и бонусы на позицию не действуют.
 */
export default function CustomItemSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [busy, setBusy] = useState(false);

  const price = parseAmount(priceText) ?? 0;
  const trimmed = name.trim();
  const tooMuch = price > PRICE_MAX;
  const canAdd = trimmed.length > 0 && price > 0 && !tooMuch && !busy;

  const add = async () => {
    if (!canAdd) return;
    haptic.medium();
    setBusy(true);
    try {
      await addCustomItem(checkId, { name: trimmed.slice(0, NAME_MAX), price });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Позиция не добавлена', message === 'Check not open' ? 'Чек уже закрыт.' : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding">
      <View style={styles.sheet}>
        <SheetHeader title="Другое" onClose={() => router.back()} />

        <FormSection title="НАЗВАНИЕ">
          <GlassCard style={styles.card}>
            <FormField icon="pencil" value={name} onChange={setName} placeholder="Например, пицца из другого заведения" autoCapitalize="sentences" autoFocus />
          </GlassCard>
        </FormSection>

        <FormSection
          title="СУММА"
          footer={tooMuch ? 'Слишком большая сумма.' : 'Склад не меняется, скидки и бонусы на эту позицию не действуют.'}>
          <GlassCard style={styles.card}>
            <FormField icon="rublesign" value={priceText} onChange={setPriceText} placeholder="0" keyboardType="decimal-pad" suffix="₽" />
          </GlassCard>
        </FormSection>

        <PrimaryButton
          title={busy ? 'Добавляем…' : price > 0 && !tooMuch ? `Добавить · ${formatMoney(price, { kopecks: 'auto' })}` : 'Добавить в чек'}
          icon="plus"
          busy={busy}
          disabled={!canAdd}
          onPress={() => void add()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.lg },
  card: { paddingHorizontal: space.lg },
});
