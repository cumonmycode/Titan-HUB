import { Button, ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, frame, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow, secondary } from '@/components/native-form';
import { chooseAction } from '@/lib/dialog';
import { formatMoney, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { cancelSalaryPayment, METHOD_LABEL, useSalaryPayments, useSalarySchemes, useUnpaidSalaries, type SalaryPayment } from '@/lib/salary-api';
import { useSession } from '@/lib/session';
import { useStaffAdmin } from '@/lib/staff-api';

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });
const dayTitle = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
const paidAt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function paymentCaption(p: SalaryPayment): string {
  const what = p.shiftOpenedAt ? `за смену ${dayTitle.format(new Date(p.shiftOpenedAt))}` : p.period ? `за ${p.period}` : 'разовая';
  return [what, METHOD_LABEL[p.paymentMethod], p.note, paidAt.format(new Date(p.createdAt))].filter(Boolean).join(' · ');
}

/**
 * Зарплата (только владелец): кому и за какие смены ещё не выдано, разовые выплаты,
 * формулы расчёта и история. Выдача — по нажатию на сотрудника: сумма по формуле с
 * расшифровкой, её можно поправить.
 */
export default function SalaryScreen() {
  const isOwner = useSession((s) => s.user?.role === 'owner');
  if (!isOwner) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ContentUnavailableView title="Только для владельца" systemImage="lock" description="Зарплату выдаёт и настраивает владелец клуба." />
      </Host>
    );
  }
  return <SalaryOwnerScreen />;
}

function SalaryOwnerScreen() {
  const router = useRouter();
  const unpaid = useUnpaidSalaries(true);
  const schemes = useSalarySchemes();
  const payments = useSalaryPayments(true);
  const staff = useStaffAdmin(true);
  const [oneOff, setOneOff] = useState<string | null>(null);
  const team = (staff.data ?? []).filter((m) => m.role === 'staff');

  const refresh = async () => {
    await Promise.allSettled([unpaid.refetch(), schemes.refetch(), payments.refetch(), staff.refetch()]);
  };

  const cancel = (p: SalaryPayment) =>
    chooseAction(`${p.staffName ?? 'Сотрудник'} · ${money(toNumber(p.amount))}`, p.paymentMethod === 'cash' ? 'Отменить выплату? Наличные вернутся в кассу открытой смены.' : 'Отменить выплату? Она исчезнет из расходов.', [
      { text: 'Не отменять', style: 'cancel' },
      {
        text: 'Отменить выплату',
        style: 'destructive',
        onPress: () =>
          void cancelSalaryPayment(p.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Не отменилось', errorText(error))),
      },
    ]);

  const due = unpaid.data ?? [];
  const dueTotal = due.reduce((s, sh) => s + sh.workers.reduce((t, w) => t + w.calculated, 0), 0);

  return (
    <>
      <Stack.Title>Зарплата</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <Section title={dueTotal > 0 ? `К выплате · ${money(dueTotal)}` : 'К выплате'} footer={<Text>Сотрудники, отмеченные на сменах за 60 дней, которым ещё не выдали зарплату.</Text>}>
            {unpaid.isLoading ? (
              <ProgressView />
            ) : !due.length ? (
              <Text modifiers={[secondary]}>Всем всё выдано</Text>
            ) : (
              due.flatMap((sh) =>
                sh.workers.map((w) => (
                  <LinkRow
                    key={`${sh.shift.id}-${w.profileId}`}
                    icon="banknote"
                    color="#34C759"
                    title={w.nickname}
                    subtitle={`Смена ${dayTitle.format(new Date(sh.shift.openedAt))} · выручка ${money(w.revenue)}`}
                    value={money(w.calculated)}
                    onPress={() => router.push({ pathname: '/manage/salary/pay', params: { shiftId: sh.shift.id, profileId: w.profileId } })}
                  />
                )),
              )
            )}
          </Section>

          <Section title="Разовая выплата" footer={<Text>Аванс или премия без привязки к смене.</Text>}>
            {staff.isLoading ? (
              <ProgressView />
            ) : !team.length ? (
              <Text modifiers={[secondary]}>В команде пока нет сотрудников.</Text>
            ) : (
              <>
                <Picker label="Кому" selection={oneOff} onSelectionChange={(v) => setOneOff(String(v))} modifiers={[pickerStyle('menu')]}>
                  {team.map((m) => (
                    <Text key={m.id} modifiers={[tag(m.id)]}>
                      {m.nickname}
                    </Text>
                  ))}
                </Picker>
                <Button
                  label="Выдать"
                  systemImage="banknote"
                  onPress={() => oneOff && router.push({ pathname: '/manage/salary/pay', params: { profileId: oneOff } })}
                  modifiers={[buttonStyle('bordered'), controlSize('large'), frame({ maxWidth: 10_000 })]}
                />
              </>
            )}
          </Section>

          <Section title="Формулы" footer={<Text>Основная действует для всех; сотруднику можно назначить свою в его карточке.</Text>}>
            {(schemes.data ?? []).map((s) => (
              <LinkRow
                key={s.id}
                icon={s.isDefault ? 'star.fill' : 'function'}
                color={s.isDefault ? '#FF9500' : '#5856D6'}
                title={s.name}
                subtitle={s.text}
                value={`${s.staffCount} чел.`}
                onPress={() => router.push({ pathname: '/manage/salary/scheme', params: { schemeId: s.id } })}
              />
            ))}
            <ActionRow title="Новая формула" icon="plus.circle.fill" onPress={() => router.push('/manage/salary/scheme')} />
          </Section>

          <Section title="История выплат" footer={<Text>{(payments.data?.length ?? 0) >= 100 ? 'Показаны последние 100. ' : ''}Нажмите на выплату, чтобы отменить ошибочную.</Text>}>
            {payments.isLoading ? (
              <ProgressView />
            ) : !payments.data?.length ? (
              <Text modifiers={[secondary]}>Выплат пока не было</Text>
            ) : (
              payments.data.map((p) => (
                <LinkRow
                  key={p.id}
                  icon={p.paymentMethod === 'cash' ? 'banknote' : 'arrow.left.arrow.right'}
                  color={p.paymentMethod === 'cash' ? '#34C759' : '#007AFF'}
                  title={p.staffName ?? 'Сотрудник'}
                  subtitle={paymentCaption(p)}
                  value={money(toNumber(p.amount))}
                  chevron={false}
                  onPress={() => cancel(p)}
                />
              ))
            )}
          </Section>
        </Form>
      </Host>
    </>
  );
}
