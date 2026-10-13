import { Button, ContentUnavailableView, Form, Host, LabeledContent, Picker, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, font, foregroundStyle, frame, monospacedDigit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { ProfileHeader } from '@/components/profile-parts';
import { FieldRow, secondary } from '@/components/native-form';
import { chooseAction } from '@/lib/dialog';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { cancelSalaryPayment, METHOD_LABEL, paySalary, useShiftSalary } from '@/lib/salary-api';
import { newIdempotencyKey, parseAmount, useCashBalance } from '@/lib/shift-api';
import { useStaffAdmin } from '@/lib/staff-api';
import { colors } from '@/lib/theme';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const dayTitle = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Выдача зарплаты сотруднику (только владелец): за смену — сумма по его формуле с
 * расшифровкой, её можно поправить; без смены — разовая выплата (аванс, премия).
 * Наличными — из кассы открытой смены, переводом — только в расходы.
 */
export function SalaryPayForm({ shiftId, profileId, onDone }: { shiftId: string | null; profileId: string; onDone: () => void }) {
  const salary = useShiftSalary(shiftId);
  const staff = useStaffAdmin(true);
  const cash = useCashBalance();
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());

  const worker = salary.data?.workers.find((w) => w.profileId === profileId) ?? null;
  const member = staff.data?.find((m) => m.id === profileId) ?? null;
  const name = worker?.nickname ?? member?.nickname ?? 'Сотрудник';
  const loading = (shiftId && salary.isLoading) || (!shiftId && staff.isLoading);

  if (loading) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  if (shiftId && !worker) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ContentUnavailableView title="Не на смене" systemImage="person.crop.circle.badge.questionmark" description="Этот сотрудник не отмечен на смене — добавьте его в состав смены." />
      </Host>
    );
  }

  const calculated = worker?.calculated ?? 0;
  const typed = parseAmount(amountText);
  const amount = amountText.trim() ? (typed ?? 0) : calculated;
  const changed = !!worker && amountText.trim() !== '' && Math.abs(amount - calculated) > 0.004;
  const inRegister = cash.data?.expected ?? null;
  const paid = worker?.paid ?? null;
  const when = salary.data ? dayTitle.format(new Date(salary.data.shift.openedAt)) : null;

  const pay = async () => {
    if (amount <= 0 || busy) return;
    haptic.medium();
    setBusy(true);
    try {
      const reason = changed ? [note.trim(), `по формуле ${money(calculated)}`].filter(Boolean).join(' · ') : note.trim();
      const r = await paySalary({ profileId, amount, method, shiftId, note: reason, idempotencyKey: key.current });
      key.current = newIdempotencyKey();
      if (r.duplicate) {
        haptic.warning();
        Alert.alert('Уже выдано', `${name} уже получил ${money(r.amount)} ${METHOD_LABEL[r.method] ?? ''} за эту смену.`);
      } else haptic.success();
      onDone();
    } catch (error) {
      haptic.error();
      Alert.alert('Зарплата не выдана', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (method === 'cash' && inRegister !== null && amount > inRegister + 0.004) {
      chooseAction(`В кассе ${money(inRegister)}`, `После выдачи касса уйдёт в минус на ${money(amount - inRegister)}. Выдать?`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Выдать', style: 'destructive', onPress: () => void pay() },
      ]);
    } else void pay();
  };

  const cancelPaid = () => {
    if (!paid) return;
    chooseAction('Отменить выплату?', paid.method === 'cash' ? `${money(paid.amount)} вернутся в кассу открытой смены.` : 'Выплата исчезнет из расходов.', [
      { text: 'Не отменять', style: 'cancel' },
      {
        text: 'Отменить выплату',
        style: 'destructive',
        onPress: () =>
          void cancelSalaryPayment(paid.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Не отменилось', errorText(error))),
      },
    ]);
  };

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form>
        <Section>
          <RNHostView matchContents>
            <ProfileHeader name={name} photoUrl={worker?.photoUrl ?? member?.photoUrl} title={name} subtitle={when ? `Смена ${when}` : 'Разовая выплата: аванс или премия'} />
          </RNHostView>
        </Section>

        {worker ? (
          <Section title="По формуле" footer={<Text>{`«${worker.scheme.name}»: ${worker.scheme.text}. База — ${worker.revenueLabel}.`}</Text>}>
            <LabeledContent label="Выручка">
              <Text modifiers={[secondary, monospacedDigit()]}>{money(worker.revenue)}</Text>
            </LabeledContent>
            {worker.lines.map((line) => (
              <LabeledContent key={line.label} label={line.label}>
                <Text modifiers={[monospacedDigit()]}>{money(line.amount)}</Text>
              </LabeledContent>
            ))}
            <LabeledContent label="Итого">
              <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(colors.accent), monospacedDigit()]}>{money(calculated)}</Text>
            </LabeledContent>
          </Section>
        ) : null}

        {paid ? (
          <Section title="Выдано" footer={<Text>{paid.calculated !== null && Math.abs(paid.calculated - paid.amount) > 0.004 ? `По формуле было ${money(paid.calculated)}.` : 'Вторую выплату за ту же смену система не создаст.'}</Text>}>
            <LabeledContent label={METHOD_LABEL[paid.method] ?? paid.method}>
              <Text modifiers={[font({ weight: 'semibold' }), monospacedDigit()]}>{money(paid.amount)}</Text>
            </LabeledContent>
            <Button label="Отменить выплату" role="destructive" onPress={cancelPaid} />
          </Section>
        ) : (
          <>
            <Section title="К выдаче" footer={<Text>{worker ? (changed ? `Поправили сумму: по формуле ${money(calculated)}. Причина уйдёт в комментарий.` : 'Пусто — выдать по формуле.') : 'Например, аванс до конца месяца.'}</Text>}>
              <FieldRow value="" placeholder={worker ? String(calculated) : 'Сумма'} keyboard="decimal-pad" onChange={setAmountText} />
              <FieldRow value="" placeholder={changed ? 'Почему другая сумма?' : 'Комментарий: премия, аванс…'} onChange={setNote} />
            </Section>
            <Section footer={<Text>{method === 'cash' ? (inRegister !== null ? `Из кассы смены: сейчас там ${money(inRegister)}.` : 'Смена закрыта — из кассы не спишется, выплата запишется в расходы.') : 'Переводом — касса не меняется, выплата попадёт в расходы.'}</Text>}>
              <Picker selection={method} onSelectionChange={(v) => setMethod(v as 'cash' | 'transfer')} modifiers={[pickerStyle('segmented')]}>
                <Text modifiers={[tag('cash')]}>Наличными</Text>
                <Text modifiers={[tag('transfer')]}>Переводом</Text>
              </Picker>
              <Button
                label={busy ? 'Выдаём…' : amount > 0 ? `Выдать ${money(amount)}` : 'Укажите сумму'}
                systemImage="banknote"
                onPress={confirm}
                modifiers={[buttonStyle('borderedProminent'), controlSize('large'), frame({ maxWidth: 10_000 }), ...(amount > 0 && !busy ? [] : [foregroundStyle('secondary')])]}
              />
            </Section>
          </>
        )}
      </Form>
    </Host>
  );
}
