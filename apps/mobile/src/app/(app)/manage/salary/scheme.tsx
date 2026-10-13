import { Form, LabeledContent, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { font, monospacedDigit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, InputRow, secondary } from '@/components/native-form';
import { chooseAction } from '@/lib/dialog';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { computeSalary, DEFAULT_RULES, deleteSalaryScheme, describeRules, REVENUE_LABEL, saveSalaryScheme, useSalarySchemes, type RevenueBase, type SalaryRules } from '@/lib/salary-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Выручка смены для проверки формулы. */
const EXAMPLES = [5000, 10_000, 15_000, 25_000];
const SHIFT_HOURS = 8;
const num = (text: string) => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const field = (n: number) => (n ? String(n) : '');

/**
 * Формула зарплаты: из чего складывается сумма за смену и от какой выручки. Ниже — сколько
 * выйдет при разной выручке, чтобы сразу видеть результат.
 */
export default function SalarySchemeScreen() {
  const { schemeId } = useLocalSearchParams<{ schemeId?: string }>();
  const router = useRouter();
  const schemes = useSalarySchemes();
  const existing = schemeId ? (schemes.data ?? []).find((s) => s.id === schemeId) ?? null : null;
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState<SalaryRules | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const rules = draft ?? existing?.rules ?? DEFAULT_RULES;
  const title = name ?? existing?.name ?? '';
  const set = (patch: Partial<SalaryRules>) => setDraft({ ...rules, ...patch });

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await saveSalaryScheme(existing?.id ?? null, { name: title.trim(), rules, isDefault: makeDefault || undefined });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Формула не сохранена', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!existing) return;
    chooseAction(`Удалить «${existing.name}»?`, 'Сотрудники с этой формулой перейдут на основную.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteSalaryScheme(existing.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Не удалилась', errorText(error))),
      },
    ]);
  };

  if (schemeId && schemes.isLoading) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }

  return (
    <>
      <EditorToolbar title={existing ? existing.name : 'Новая формула'} canSave={!!title.trim()} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название">
            <FieldRow value={title} placeholder="Например, Основная или Старший админ" maxLength={60} onChange={setName} />
          </Section>

          <Section title="Из чего складывается" footer={<Text>{describeRules(rules)}</Text>}>
            <InputRow label="Ставка за смену, ₽" value={field(rules.base)} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ base: num(v) })} />
            <InputRow label="Процент от выручки, %" value={field(rules.percent)} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ percent: Math.min(num(v), 100) })} />
            <InputRow label="В час, ₽" value={field(rules.hourly)} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ hourly: num(v) })} />
          </Section>

          <Section title="Ступени" footer={<Text>Например: +100 ₽ за каждую начатую 1 000 ₽ выручки сверх 7 000 ₽. Пусто — без ступеней.</Text>}>
            <InputRow label="Прибавка, ₽" value={field(rules.stepAdd)} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ stepAdd: num(v) })} />
            <InputRow label="За каждые, ₽" value={field(rules.stepEvery)} placeholder="1000" keyboard="decimal-pad" onChange={(v) => set({ stepEvery: num(v) })} />
            <InputRow label="Сверх выручки, ₽" value={field(rules.stepFrom)} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ stepFrom: num(v) })} />
          </Section>

          <Section title="Ограничения" footer={<Text>Минимум — гарантия за смену, потолок — больше не выйдет. Пусто — без ограничения.</Text>}>
            <InputRow label="Не меньше, ₽" value={field(rules.min)} placeholder="—" keyboard="decimal-pad" onChange={(v) => set({ min: num(v) })} />
            <InputRow label="Не больше, ₽" value={field(rules.max)} placeholder="—" keyboard="decimal-pad" onChange={(v) => set({ max: num(v) })} />
          </Section>

          <Section title="От какой выручки" footer={<Text>{`${REVENUE_LABEL[rules.revenue].hint}. Возвраты вычитаются.`}</Text>}>
            <Picker selection={rules.revenue} onSelectionChange={(v) => set({ revenue: v as RevenueBase })} modifiers={[pickerStyle('segmented')]}>
              {(Object.keys(REVENUE_LABEL) as RevenueBase[]).map((k) => (
                <Text key={k} modifiers={[tag(k)]}>
                  {REVENUE_LABEL[k].title}
                </Text>
              ))}
            </Picker>
            <Toggle label="Учитывать мероприятия" isOn={rules.events} onIsOnChange={(on) => set({ events: on })} />
          </Section>

          <Section title={`Сколько выйдет за смену ${SHIFT_HOURS} ч`}>
            {EXAMPLES.map((revenue) => (
              <LabeledContent key={revenue} label={`Выручка ${formatMoney(revenue)}`}>
                <Text modifiers={[font({ weight: 'semibold' }), monospacedDigit()]}>{formatMoney(computeSalary(rules, { revenue, hours: SHIFT_HOURS }).amount)}</Text>
              </LabeledContent>
            ))}
          </Section>

          {existing?.isDefault ? (
            <Section>
              <Text modifiers={[secondary]}>Это основная формула клуба.</Text>
            </Section>
          ) : (
            <Section footer={<Text>Основная формула действует для всех, кому не назначена своя.</Text>}>
              <Toggle label="Сделать основной" isOn={makeDefault} onIsOnChange={setMakeDefault} />
            </Section>
          )}

          {existing && !existing.isDefault ? (
            <Section>
              <ActionRow title="Удалить формулу" icon="trash" destructive onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}
