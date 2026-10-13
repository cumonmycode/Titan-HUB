import { Button, Form, HStack, Host, LabeledContent, ProgressView, Section, Spacer, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, font, foregroundStyle, monospacedDigit } from '@expo/ui/swift-ui/modifiers';
import { useMutation } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { CashField } from '@/components/cash-field';
import { api } from '@/lib/api';
import { formatMoney, plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { invalidateShift, parseAmount, useCashBalance } from '@/lib/shift-api';
import { ToolbarButton } from '@/components/toolbar';
import { LinkRow } from '@/components/native-form';
import { useShiftSummary } from '@/lib/queries';
import { useShiftSalary } from '@/lib/salary-api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type CloseResult = { analytics?: { totalRevenue: number | string; checksCount: number; avgCheck: number | string } };

const cashMoney = (value: number, sign = false) => formatMoney(value, { sign, kopecks: 'auto' });

/**
 * Закрытие смены: кто работал и сколько им положено (выдаёт владелец — прямо здесь),
 * внесение и изъятие, затем пересчёт наличных; расхождение — только с причиной.
 */
export default function CloseShift() {
  const router = useRouter();
  const balance = useCashBalance();
  const summary = useShiftSummary();
  const isOwner = useSession((st) => st.user?.role === 'owner');
  const shift = summary.data?.shift ?? null;
  const team = (summary.data?.shift ? summary.data.staff : undefined) ?? [];
  const salary = useShiftSalary(shift?.id);
  const [typed, setTyped] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // Ключ поля суммы, замороженный при первом вводе. Пока пользователь ничего не набрал,
  // поле перемонтируется с каждым новым предзаполнением (CashField читает initial один раз):
  // иначе после перезапроса кэша поле показывало бы старую сумму, а отправлялась бы новая.
  const [typedFieldKey, setTypedFieldKey] = useState<string | null>(null);

  const expected = balance.data?.expected ?? null;
  // Предзаполняем ожидаемой суммой; при совпадении отправим точный float сервера.
  const prefill = expected !== null ? String(Math.round(expected * 100) / 100) : null;
  const cashText = typed ?? prefill ?? '';

  const cash = parseAmount(cashText);
  // Копеечный шум float не должен требовать причину: сервер сравнивает строго.
  const matches = cash !== null && expected !== null && Math.abs(cash - expected) < 0.005;
  const diff = cash !== null && expected !== null && !matches ? Math.round((cash - expected) * 100) / 100 : 0;
  const needsReason = cash !== null && expected !== null && !matches;
  const canSubmit = cash !== null && expected !== null && (!needsReason || reason.trim().length > 0);

  const close = useMutation({
    mutationFn: () =>
      api.post<CloseResult>('/shifts/close', {
        cashEnd: matches ? expected : cash,
        adjustmentReason: needsReason ? reason.trim() : undefined,
      }),
    onSuccess: (result) => finish(result.analytics),
    onError: async () => {
      // Аналитика считается уже после закрытия: её сбой даёт 400, хотя смена закрыта.
      const summary = await api.get<{ shift: unknown }>('/pos/shift-summary').catch(() => null);
      if (summary && !summary.shift) return finish();
      haptic.error();
      // Ожидаемый остаток на сервере мог измениться (оплата, возврат, изъятие) —
      // перечитываем его, иначе экран считает, что всё сходится, и не просит причину.
      await balance.refetch();
    },
  });

  function finish(analytics?: CloseResult['analytics']) {
    haptic.success();
    invalidateShift();
    Alert.alert(
      'Смена закрыта',
      analytics
        ? `Выручка ${formatMoney(analytics.totalRevenue)} · ${analytics.checksCount} ${plural(analytics.checksCount, ['чек', 'чека', 'чеков'])} · средний ${formatMoney(analytics.avgCheck)}`
        : undefined,
    );
    router.dismissTo('/pos');
  }

  const b = balance.data;

  return (
    <>
      <Stack.Toolbar placement="right">
        <ToolbarButton variant="prominent" disabled={!canSubmit || close.isPending} onPress={() => close.mutate()}>
          {close.isPending ? 'Закрываем…' : 'Закрыть'}
        </ToolbarButton>
      </Stack.Toolbar>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Кто работал">
            <LinkRow
              icon="person.2.fill"
              color={colors.accent}
              title={team.length ? team.map((w) => w.nickname).join(', ') : 'Никого не отметили'}
              value="Изменить"
              onPress={() => router.push('/shift/staff')}
            />
          </Section>

          {(salary.data?.workers.length ?? 0) > 0 && (
            <Section
              title="Зарплата за смену"
              footer={<Text>{isOwner ? 'Нажмите на сотрудника — сумму по формуле можно поправить. Наличные выдаются из кассы до пересчёта.' : 'Зарплату выдаёт владелец — после закрытия он получит напоминание.'}</Text>}>
              {salary.data!.workers.map((w) => (
                <LinkRow
                  key={w.profileId}
                  icon={w.paid ? 'checkmark.circle.fill' : 'banknote'}
                  color={w.paid ? colors.green : colors.orange}
                  title={w.nickname}
                  subtitle={w.paid ? `Выдано ${cashMoney(w.paid.amount)}` : `По формуле «${w.scheme.name}»`}
                  value={cashMoney(w.paid ? w.paid.amount : w.calculated)}
                  onPress={isOwner ? () => router.push({ pathname: '/shift/pay', params: { shiftId: shift!.id, profileId: w.profileId } }) : undefined}
                />
              ))}
            </Section>
          )}

          <Section title="Внести или изъять">
            <HStack spacing={10}>
              <Button label="Внести" systemImage="arrow.down.circle" onPress={() => router.push({ pathname: '/shift/cash', params: { type: 'deposit' } })} modifiers={[buttonStyle('bordered'), controlSize('large')]} />
              <Spacer />
              <Button label="Изъять" systemImage="arrow.up.circle" onPress={() => router.push({ pathname: '/shift/cash', params: { type: 'withdrawal' } })} modifiers={[buttonStyle('bordered'), controlSize('large')]} />
            </HStack>
          </Section>

          {balance.isLoading || !b ? (
            <Section>
              <ProgressView />
            </Section>
          ) : (
            <Section title="Ожидается в кассе">
              <LabeledContent label="Итого">
                <Text modifiers={[font({ weight: 'bold', design: 'rounded' }), monospacedDigit()]}>{cashMoney(b.expected)}</Text>
              </LabeledContent>
              <LabeledContent label="Начало смены">
                <Text modifiers={[monospacedDigit()]}>{cashMoney(b.cashStart)}</Text>
              </LabeledContent>
              {!!b.cashPayments && (
                <LabeledContent label="Наличные оплаты">
                  <Text modifiers={[monospacedDigit()]}>{cashMoney(b.cashPayments, true)}</Text>
                </LabeledContent>
              )}
              {!!b.deposits && (
                <LabeledContent label="Внесения">
                  <Text modifiers={[monospacedDigit()]}>{cashMoney(b.deposits, true)}</Text>
                </LabeledContent>
              )}
              {!!b.withdrawals && (
                <LabeledContent label="Изъятия">
                  <Text modifiers={[monospacedDigit()]}>{cashMoney(-b.withdrawals)}</Text>
                </LabeledContent>
              )}
              {!!b.salaries && (
                <LabeledContent label="Зарплаты">
                  <Text modifiers={[monospacedDigit()]}>{cashMoney(-b.salaries)}</Text>
                </LabeledContent>
              )}
              {!!b.cashRefundTotal && (
                <LabeledContent label="Возвраты наличными">
                  <Text modifiers={[monospacedDigit()]}>{cashMoney(-b.cashRefundTotal)}</Text>
                </LabeledContent>
              )}
            </Section>
          )}

          <Section
            title="Фактически в кассе"
            footer={<Text>{matches ? 'Всё сходится.' : needsReason ? (diff > 0 ? 'Излишек будет проведён внесением.' : 'Недостача будет проведена изъятием.') : 'Пересчитайте наличные.'}</Text>}>
            {prefill === null ? (
              <ProgressView />
            ) : (
              <CashField
                key={typedFieldKey ?? prefill}
                initial={prefill}
                onChange={(text) => {
                  setTypedFieldKey((key) => key ?? prefill);
                  setTyped(text);
                }}
              />
            )}
          </Section>

          {needsReason && (
            <Section title={diff > 0 ? `Излишек ${cashMoney(diff, true)}` : `Недостача ${cashMoney(-diff)}`}>
              <ReasonField value={reason} onChange={setReason} />
            </Section>
          )}

          {close.isError && (
            <Section>
              <Text modifiers={[foregroundStyle('red')]}>{closeErrorMessage(close.error.message)}</Text>
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}

/**
 * Поле причины привязано к состоянию: когда суммы сошлись, поле пропадает, а набранная причина
 * остаётся; при новом расхождении поле появляется уже с ней — уходит ровно то, что видно.
 */
function ReasonField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const text = useNativeState(value);
  return <TextField text={text} placeholder="Причина расхождения" onTextChange={onChange} />;
}

function closeErrorMessage(message: string): string {
  if (message === 'No open shift' || message === 'Shift already closed') return 'Смена уже закрыта';
  return message;
}
