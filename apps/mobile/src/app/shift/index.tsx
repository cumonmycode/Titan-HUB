import {
  Button,
  ContentUnavailableView,
  Form,
  HStack,
  Host,
  LabeledContent,
  ProgressView,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundStyle,
  frame,
  monospacedDigit,
  refreshable,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { formatMoney, formatTime, plural } from '@/lib/format';
import { useShiftSummary } from '@/lib/queries';
import { ToolbarButton } from '@/components/toolbar';
import { LinkRow } from '@/components/native-form';
import { colors } from '@/lib/theme';

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** Шторка смены: сводка и действия. Открывается из плашки над таб-баром. */
export default function ShiftSheet() {
  const router = useRouter();
  const summary = useShiftSummary();
  const data = summary.data;

  const doneButton = (
    <Stack.Toolbar placement="right">
      <ToolbarButton variant="done" tintColor={colors.accent} onPress={() => router.back()}>
        Готово
      </ToolbarButton>
    </Stack.Toolbar>
  );

  if (!data) {
    return (
      <>
        {doneButton}
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          {summary.isError ? (
            <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={summary.error.message} />
          ) : (
            <ProgressView />
          )}
        </Host>
      </>
    );
  }

  if (!data.shift) {
    return (
      <>
        {doneButton}
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          <Form>
            <Section>
              <ContentUnavailableView
                title="Смена закрыта"
                systemImage="moon.zzz"
                description="Чтобы открывать чеки, начните смену и пересчитайте наличные в кассе."
              />
            </Section>
            <Section>
              <Button
                label="Открыть смену"
                systemImage="sunrise"
                onPress={() => router.push('/shift/open')}
                modifiers={[buttonStyle('borderedProminent'), controlSize('large'), frame({ maxWidth: 10_000 })]}
              />
            </Section>
          </Form>
        </Host>
      </>
    );
  }

  const { openChecks, cashInRegister, forecast } = data;
  const perCheck = forecast ? [...forecast.perCheck].sort((a, b) => b.projected - a.projected) : [];

  return (
    <>
      {doneButton}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form
          modifiers={[
            refreshable(async () => {
              await summary.refetch();
            }),
          ]}>
          <Section footer={<Text>Сумма открытых чеков — без аренды зон.</Text>}>
            <LabeledContent label="Открыта">
              <Text modifiers={[monospacedDigit()]}>{formatTime(data.shift.openedAt)}</Text>
            </LabeledContent>
            <LabeledContent label={`Открыто · ${openChecks.count} ${plural(openChecks.count, ['чек', 'чека', 'чеков'])}`}>
              <Text modifiers={[monospacedDigit(), contentTransition('numericText'), animation(Animation.default, openChecks.total)]}>
                {formatMoney(openChecks.total)}
              </Text>
            </LabeledContent>
            <LabeledContent label="В кассе">
              <Text
                modifiers={[
                  font({ weight: 'semibold' }),
                  monospacedDigit(),
                  contentTransition('numericText'),
                  animation(Animation.default, cashInRegister),
                ]}>
                {formatMoney(cashInRegister)}
              </Text>
            </LabeledContent>
          </Section>

          <Section title="На смене" footer={<Text>Зарплату за смену получат отмеченные сотрудники.</Text>}>
            <LinkRow
              icon="person.2.fill"
              color={colors.accent}
              title={data.staff?.length ? data.staff.map((w) => w.nickname).join(', ') : 'Никого не отметили'}
              value="Изменить"
              onPress={() => router.push('/shift/staff')}
            />
          </Section>

          <Section title="Наличные в кассе">
            <HStack spacing={10}>
              <Button
                label="Внести"
                systemImage="arrow.down.circle"
                onPress={() => router.push({ pathname: '/shift/cash', params: { type: 'deposit' } })}
                modifiers={[buttonStyle('bordered'), controlSize('large')]}
              />
              <Spacer />
              <Button
                label="Изъять"
                systemImage="arrow.up.circle"
                onPress={() => router.push({ pathname: '/shift/cash', params: { type: 'withdrawal' } })}
                modifiers={[buttonStyle('bordered'), controlSize('large')]}
              />
            </HStack>
          </Section>

          {forecast && (
            <Section
              title="Прогноз вечера · Tai"
              footer={<Text>Каждый открытый чек дотягивается до среднего чека гостя за 120 дней.</Text>}>
              <LabeledContent label="Ожидаем">
                <Text
                  modifiers={[
                    font({ weight: 'bold', design: 'rounded' }),
                    monospacedDigit(),
                    contentTransition('numericText'),
                    animation(Animation.default, forecast.amount),
                  ]}>
                  {formatMoney(forecast.amount)}
                </Text>
              </LabeledContent>
              {forecast.additional > 0 && (
                <LabeledContent label="К текущему">
                  <Text modifiers={[monospacedDigit(), foregroundStyle('green')]}>{formatMoney(forecast.additional, { sign: true })}</Text>
                </LabeledContent>
              )}
            </Section>
          )}

          {perCheck.length > 0 && (
            <Section title="По чекам">
              {perCheck.map((row) => (
                <HStack key={row.checkId} spacing={12}>
                  <VStack alignment="leading" spacing={2}>
                    <Text>{row.name}</Text>
                    <Text modifiers={[font({ textStyle: 'footnote' }), secondary]}>
                      {row.avgSpend !== null
                        ? `обычно ${formatMoney(row.avgSpend)} · ${row.samples} ${plural(row.samples, ['чек', 'чека', 'чеков'])}${row.weekdayBased ? ' (этот день)' : ''}`
                        : 'без истории — по текущей сумме'}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text modifiers={[font({ weight: 'semibold' }), monospacedDigit()]}>{formatMoney(row.projected)}</Text>
                </HStack>
              ))}
            </Section>
          )}

          <Section
            footer={
              <Text>
                {openChecks.count > 0
                  ? 'Перед закрытием смены закройте все открытые чеки.'
                  : 'Пересчитайте наличные — касса сверит их с ожидаемой суммой.'}
              </Text>
            }>
            <Button
              label="Закрыть смену"
              systemImage="moon"
              role="destructive"
              onPress={() => router.push('/shift/close')}
              modifiers={[buttonStyle('bordered'), controlSize('large'), frame({ maxWidth: 10_000 })]}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
