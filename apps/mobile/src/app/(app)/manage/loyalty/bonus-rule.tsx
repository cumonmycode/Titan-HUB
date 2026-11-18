import { DatePicker, Form, Picker, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { WeekdayChips } from '@/components/loyalty-parts';
import { ActionRow, FieldRow, FormHost, InputRow, LinkRow, TimeRow } from '@/components/native-form';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { chooseAction } from '@/lib/dialog';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import {
  AUDIENCE_LABEL,
  bonusRuleTemplate,
  deleteBonusRule,
  discountSummary,
  emptyBonusRule,
  ruleToInput,
  ruleValueText,
  saveBonusRule,
  useBonusRules,
  usePickDraft,
  type BonusRuleInput,
  type BonusRuleKind,
  type DiscountAudience,
  type DiscountScope,
} from '@/lib/loyalty-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const num = (text: string) => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const AUDIENCES: DiscountAudience[] = ['all', 'tiers', 'staff', 'first'];
const today = () => toDateString(new Date());

const KIND_HINT: Record<BonusRuleKind, string> = {
  percent: 'На позиции «на что» начисляется этот процент вместо обычного. Так можно дать 10% за бар или 0% за тарифы.',
  multiplier: 'Обычный процент умножается: ×2 — двойные бонусы. Из нескольких множителей действует самый большой.',
  fixed: 'Фиксированные бонусы за каждый подходящий чек — сверху к процентам. Несколько таких правил складываются.',
};

/**
 * Правило начисления бонусов: что даёт (свой процент, множитель или бонусы за чек),
 * на что, кому, когда и от какой суммы. Под названием — правило одной строкой.
 */
export default function BonusRuleEditor() {
  const { ruleId, template } = useLocalSearchParams<{ ruleId?: string; template?: string }>();
  const router = useRouter();
  const rules = useBonusRules();
  const tiers = useClientTiers();
  const goods = useGoods();
  const startPick = usePickDraft((s) => s.start);
  const existing = ruleId ? (rules.data ?? []).find((r) => r.id === ruleId) ?? null : null;
  const [draft, setDraft] = useState<BonusRuleInput | null>(null);
  const [busy, setBusy] = useState(false);

  const r = draft ?? (existing ? ruleToInput(existing) : (template && bonusRuleTemplate(template)) || emptyBonusRule());
  const set = (patch: Partial<BonusRuleInput>) => setDraft({ ...r, ...patch });
  const valueBad = r.kind === 'percent' ? r.value > 100 : r.kind === 'multiplier' ? r.value < 1 || r.value > 10 : r.value <= 0;
  const scopeEmpty = (r.scope === 'categories' && !r.categoryIds.length) || (r.scope === 'items' && !r.itemIds.length);
  const tiersEmpty = r.audience === 'tiers' && !r.tiers.length;
  const ready = !!r.name.trim() && !valueBad && !scopeEmpty && !tiersEmpty;

  const names = {
    tier: (key: string) => tierLook(key, tiers.data).label,
    category: (id: string) => goods.data?.categories.find((c) => c.id === id)?.name ?? 'категория',
  };
  const summary = `${ruleValueText(r)} · ${discountSummary({ ...r, minQuantity: 1 }, names)}`;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await saveBonusRule(existing?.id ?? null, r);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Правило не сохранено', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!existing) return;
    chooseAction(`Удалить «${existing.name}»?`, 'Уже начисленные бонусы останутся у гостей.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteBonusRule(existing.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Не удалилось', errorText(error))),
      },
    ]);
  };

  const pick = (kind: 'categories' | 'items') => {
    startPick(kind, kind === 'categories' ? r.categoryIds : r.itemIds, (ids) => set(kind === 'categories' ? { categoryIds: ids } : { itemIds: ids }));
    router.push('/manage/loyalty/pick');
  };
  const picked = r.scope === 'categories' ? r.categoryIds : r.itemIds;
  const pickedNames = picked
    .map((id) => (r.scope === 'categories' ? goods.data?.categories.find((c) => c.id === id)?.name : goods.data?.byId.get(id)?.name))
    .filter(Boolean)
    .join(', ');
  const hasTime = r.timeFrom !== null && r.timeTo !== null;
  const hasDates = r.startsOn !== null || r.endsOn !== null;
  const valueHint = valueBad
    ? r.kind === 'multiplier' ? 'Множитель — от 1 до 10.' : r.kind === 'percent' ? 'Процент — не больше 100.' : 'Укажите, сколько бонусов.'
    : KIND_HINT[r.kind];

  return (
    <>
      <EditorToolbar title={existing ? 'Правило бонусов' : 'Новое правило'} canSave={ready} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название" footer={<Text>{summary}</Text>}>
            <FieldRow value={r.name} placeholder="Например, Двойные бонусы по вторникам" maxLength={80} onChange={(name) => set({ name })} />
            <Toggle label="Включено" isOn={r.isActive} onIsOnChange={(isActive) => set({ isActive })} />
          </Section>

          <Section title="Что даёт" footer={<Text>{valueHint}</Text>}>
            <Picker
              selection={r.kind}
              onSelectionChange={(v) => {
                const kind = v as BonusRuleKind;
                set({ kind, value: kind === 'multiplier' ? 2 : kind === 'percent' ? 10 : 100 });
              }}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('multiplier')]}>Множитель</Text>
              <Text modifiers={[tag('percent')]}>Свой %</Text>
              <Text modifiers={[tag('fixed')]}>За чек</Text>
            </Picker>
            <InputRow
              label={r.kind === 'multiplier' ? 'Умножить на' : r.kind === 'percent' ? 'Процент, %' : 'Бонусов за чек'}
              value={r.value ? String(r.value) : ''}
              placeholder="0"
              keyboard="decimal-pad"
              onChange={(v) => set({ value: num(v) })}
            />
          </Section>

          <Section title="На что" footer={<Text>{scopeEmpty ? 'Выберите, на что действует правило.' : 'Категории без бонусов начинают давать бонусы, только если правило называет их явно.'}</Text>}>
            <Picker selection={r.scope} onSelectionChange={(v) => set({ scope: v as DiscountScope })} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('check')]}>Весь чек</Text>
              <Text modifiers={[tag('categories')]}>Категории</Text>
              <Text modifiers={[tag('items')]}>Позиции</Text>
            </Picker>
            {r.scope !== 'check' && (
              <LinkRow
                icon={r.scope === 'categories' ? 'square.grid.2x2' : 'list.bullet'}
                color="#5856D6"
                title={pickedNames || (r.scope === 'categories' ? 'Выбрать категории' : 'Выбрать позиции')}
                value={picked.length ? String(picked.length) : undefined}
                onPress={() => pick(r.scope as 'categories' | 'items')}
              />
            )}
          </Section>

          <Section title="Кому" footer={tiersEmpty ? <Text>Отметьте хотя бы один статус.</Text> : undefined}>
            <Picker label="Кому" selection={r.audience} onSelectionChange={(v) => set({ audience: v as DiscountAudience })} modifiers={[pickerStyle('menu')]}>
              {AUDIENCES.map((a) => (
                <Text key={a} modifiers={[tag(a)]}>
                  {AUDIENCE_LABEL[a]}
                </Text>
              ))}
            </Picker>
            {r.audience === 'tiers' &&
              (tiers.data ?? []).map((t) => (
                <Toggle
                  key={t.key}
                  label={tierLook(t.key, tiers.data).label}
                  isOn={r.tiers.includes(t.key)}
                  onIsOnChange={(on) => set({ tiers: on ? [...r.tiers, t.key] : r.tiers.filter((x) => x !== t.key) })}
                />
              ))}
            <Toggle label="Только около дня рождения" isOn={r.birthdayDays !== null} onIsOnChange={(on) => set({ birthdayDays: on ? 3 : null })} />
            {r.birthdayDays !== null && (
              <InputRow label="± дней от даты" value={r.birthdayDays ? String(r.birthdayDays) : ''} placeholder="0" keyboard="numeric" onChange={(v) => set({ birthdayDays: Math.min(Math.round(num(v)), 31) })} />
            )}
          </Section>

          <Section title="Когда" footer={<Text>Сверяется с временем открытия чека. Время может идти через полночь: 22:00–02:00.</Text>}>
            <RNHostView matchContents>
              <WeekdayChips value={r.weekdays} onChange={(weekdays) => set({ weekdays })} />
            </RNHostView>
            <Toggle label="Только в определённые часы" isOn={hasTime} onIsOnChange={(on) => set(on ? { timeFrom: '12:00', timeTo: '18:00' } : { timeFrom: null, timeTo: null })} />
            {hasTime && (
              <>
                <TimeRow label="С" value={r.timeFrom ?? '12:00'} onChange={(timeFrom) => set({ timeFrom })} />
                <TimeRow label="До" value={r.timeTo ?? '18:00'} onChange={(timeTo) => set({ timeTo })} />
              </>
            )}
            <Toggle label="Только в период" isOn={hasDates} onIsOnChange={(on) => set(on ? { startsOn: today(), endsOn: null } : { startsOn: null, endsOn: null })} />
            {hasDates && (
              <>
                <DatePicker title="С" selection={fromDateTime(r.startsOn ?? today(), '12:00')} displayedComponents={['date']} onDateChange={(date) => set({ startsOn: toDateString(date) })} />
                <Toggle label="Есть дата окончания" isOn={r.endsOn !== null} onIsOnChange={(on) => set({ endsOn: on ? (r.startsOn ?? today()) : null })} />
                {r.endsOn !== null && <DatePicker title="По" selection={fromDateTime(r.endsOn, '12:00')} displayedComponents={['date']} onDateChange={(date) => set({ endsOn: toDateString(date) })} />}
              </>
            )}
          </Section>

          <Section title="Условие" footer={<Text>Сумма — сколько гость заплатил деньгами за чек.</Text>}>
            <InputRow label="От суммы чека, ₽" value={r.minCheckSum ? String(r.minCheckSum) : ''} placeholder="без порога" keyboard="decimal-pad" onChange={(v) => set({ minCheckSum: num(v) })} />
          </Section>

          {existing ? (
            <Section>
              <ActionRow title="Удалить правило" icon="trash" destructive onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}
