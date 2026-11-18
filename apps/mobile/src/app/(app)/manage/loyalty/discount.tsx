import { DatePicker, Form, Picker, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, InputRow, LinkRow, TimeRow } from '@/components/native-form';
import { WeekdayChips } from '@/components/loyalty-parts';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { chooseAction } from '@/lib/dialog';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import {
  AUDIENCE_LABEL,
  deleteDiscount,
  discountTemplate,
  emptyDiscount,
  saveDiscount,
  SCOPE_LABEL,
  toInput,
  useDiscounts,
  usePickDraft,
  type DiscountAudience,
  type DiscountInput,
  type DiscountScope,
} from '@/lib/loyalty-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const num = (text: string) => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const AUDIENCES: DiscountAudience[] = ['all', 'tiers', 'staff', 'first'];
const today = () => toDateString(new Date());

/**
 * Скидка: размер, как применяется (сама или кассиром), на что, кому, когда и от какой
 * суммы. Время и дни сверяются с моментом открытия чека.
 */
export default function DiscountEditor() {
  const { discountId, template } = useLocalSearchParams<{ discountId?: string; template?: string }>();
  const router = useRouter();
  const discounts = useDiscounts();
  const tiers = useClientTiers();
  const goods = useGoods();
  const startPick = usePickDraft((s) => s.start);
  const existing = discountId ? (discounts.data ?? []).find((d) => d.id === discountId) ?? null : null;
  const [draft, setDraft] = useState<DiscountInput | null>(null);
  const [busy, setBusy] = useState(false);

  const d = draft ?? (existing ? toInput(existing) : (template && discountTemplate(template)) || emptyDiscount());
  const free = d.mechanic === 'free_units';
  const set = (patch: Partial<DiscountInput>) => setDraft({ ...d, ...patch });
  const percentTooBig = d.type === 'percent' && d.value > 100;
  const scopeEmpty = (d.scope === 'categories' && !d.categoryIds.length) || (d.scope === 'items' && !d.itemIds.length);
  const tiersEmpty = d.audience === 'tiers' && !d.tiers.length;
  const freeInvalid = free && !(d.freeEvery && d.freeEvery >= 2);
  const ready = !!d.name.trim() && (free ? !freeInvalid : d.value > 0) && !percentTooBig && !scopeEmpty && !tiersEmpty;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await saveDiscount(existing?.id ?? null, d);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Скидка не сохранена', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!existing) return;
    chooseAction(`Удалить «${existing.name}»?`, 'Из открытых чеков она пропадёт при следующем пересчёте.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteDiscount(existing.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Не удалилась', errorText(error))),
      },
    ]);
  };

  const pick = (kind: 'categories' | 'items') => {
    startPick(kind, kind === 'categories' ? d.categoryIds : d.itemIds, (ids) => set(kind === 'categories' ? { categoryIds: ids } : { itemIds: ids }));
    router.push('/manage/loyalty/pick');
  };

  const picked = d.scope === 'categories' ? d.categoryIds : d.itemIds;
  const pickedNames = picked
    .map((id) => (d.scope === 'categories' ? goods.data?.categories.find((c) => c.id === id)?.name : goods.data?.byId.get(id)?.name))
    .filter(Boolean)
    .join(', ');
  const hasTime = d.timeFrom !== null && d.timeTo !== null;
  const hasDates = d.startsOn !== null || d.endsOn !== null;

  return (
    <>
      <EditorToolbar title={existing ? 'Скидка' : 'Новая скидка'} canSave={ready} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название">
            <FieldRow value={d.name} placeholder="Например, Счастливые часы" maxLength={60} onChange={(name) => set({ name })} />
            <FieldRow value={d.description ?? ''} placeholder="Описание для кассира (необязательно)" maxLength={300} onChange={(description) => set({ description })} />
          </Section>

          <Section title="Что даёт" footer={<Text>{free ? freeHint(d.freeEvery, d.freeHistory) : percentTooBig ? 'Процент — не больше 100.' : 'Процент или сумма от позиций «на что».'}</Text>}>
            <Picker
              selection={free ? 'free' : d.type}
              onSelectionChange={(v) =>
                set(v === 'free' ? { mechanic: 'free_units', type: 'percent', value: 100, freeEvery: d.freeEvery ?? 2 } : { mechanic: 'simple', type: v as 'percent' | 'fixed' })
              }
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('percent')]}>Процент</Text>
              <Text modifiers={[tag('fixed')]}>Сумма, ₽</Text>
              <Text modifiers={[tag('free')]}>N-й бесплатно</Text>
            </Picker>
            {free ? (
              <>
                <InputRow label="Бесплатно каждый, шт." value={d.freeEvery ? String(d.freeEvery) : ''} placeholder="2" keyboard="numeric" onChange={(v) => set({ freeEvery: Math.min(100, Math.round(num(v))) || null })} />
                <Toggle label="Копить между визитами" isOn={d.freeHistory} onIsOnChange={(freeHistory) => set({ freeHistory })} />
              </>
            ) : (
              <InputRow label={d.type === 'percent' ? 'Скидка, %' : 'Скидка, ₽'} value={d.value ? String(d.value) : ''} placeholder="0" keyboard="decimal-pad" onChange={(v) => set({ value: num(v) })} />
            )}
          </Section>

          <Section footer={<Text>{d.isAuto ? 'Скидка сама ложится на подходящий чек.' : 'Кассир выбирает скидку в чеке — «Скидка → Скидки клуба».'}</Text>}>
            <Toggle label="Применять автоматически" isOn={d.isAuto} onIsOnChange={(isAuto) => set({ isAuto })} />
            <Toggle label="Складывается с другими" isOn={d.combinable} onIsOnChange={(combinable) => set({ combinable })} />
            <Toggle label="Включена" isOn={d.isActive} onIsOnChange={(isActive) => set({ isActive })} />
          </Section>

          <Section title="На что" footer={scopeEmpty ? <Text>Выберите, на что действует скидка.</Text> : undefined}>
            <Picker selection={d.scope} onSelectionChange={(v) => set({ scope: v as DiscountScope })} modifiers={[pickerStyle('segmented')]}>
              {(Object.keys(SCOPE_LABEL) as DiscountScope[]).map((k) => (
                <Text key={k} modifiers={[tag(k)]}>
                  {k === 'check' ? 'Весь чек' : k === 'categories' ? 'Категории' : 'Позиции'}
                </Text>
              ))}
            </Picker>
            {d.scope !== 'check' && (
              <LinkRow
                icon={d.scope === 'categories' ? 'square.grid.2x2' : 'list.bullet'}
                color="#5856D6"
                title={pickedNames || (d.scope === 'categories' ? 'Выбрать категории' : 'Выбрать позиции')}
                value={picked.length ? String(picked.length) : undefined}
                onPress={() => pick(d.scope as 'categories' | 'items')}
              />
            )}
          </Section>

          <Section title="Кому" footer={tiersEmpty ? <Text>Отметьте хотя бы один статус.</Text> : undefined}>
            <Picker label="Кому" selection={d.audience} onSelectionChange={(v) => set({ audience: v as DiscountAudience })} modifiers={[pickerStyle('menu')]}>
              {(d.audience === 'clients' ? [...AUDIENCES, 'clients' as const] : AUDIENCES).map((a) => (
                <Text key={a} modifiers={[tag(a)]}>
                  {AUDIENCE_LABEL[a]}
                </Text>
              ))}
            </Picker>
            {d.audience === 'tiers' &&
              (tiers.data ?? []).map((t) => (
                <Toggle
                  key={t.key}
                  label={tierLook(t.key, tiers.data).label}
                  isOn={d.tiers.includes(t.key)}
                  onIsOnChange={(on) => set({ tiers: on ? [...d.tiers, t.key] : d.tiers.filter((x) => x !== t.key) })}
                />
              ))}
            {d.audience === 'clients' && <Text>{`Персональная скидка для ${d.clientIds.length} клиентов`}</Text>}
            <Toggle label="Только в день рождения" isOn={d.birthdayDays !== null} onIsOnChange={(on) => set({ birthdayDays: on ? 0 : null })} />
            {d.birthdayDays !== null && (
              <InputRow label="± дней от даты" value={d.birthdayDays ? String(d.birthdayDays) : ''} placeholder="0" keyboard="numeric" onChange={(v) => set({ birthdayDays: Math.min(Math.round(num(v)), 31) })} />
            )}
          </Section>

          <Section title="Когда" footer={<Text>Сверяется с временем открытия чека. Время может идти через полночь: 22:00–02:00.</Text>}>
            <RNHostView matchContents>
              <WeekdayChips value={d.weekdays} onChange={(weekdays) => set({ weekdays })} />
            </RNHostView>
            <Toggle label="Только в определённые часы" isOn={hasTime} onIsOnChange={(on) => set(on ? { timeFrom: '17:00', timeTo: '19:00' } : { timeFrom: null, timeTo: null })} />
            {hasTime && (
              <>
                <TimeRow label="С" value={d.timeFrom ?? '17:00'} onChange={(timeFrom) => set({ timeFrom })} />
                <TimeRow label="До" value={d.timeTo ?? '19:00'} onChange={(timeTo) => set({ timeTo })} />
              </>
            )}
            <Toggle label="Только в период" isOn={hasDates} onIsOnChange={(on) => set(on ? { startsOn: today(), endsOn: null } : { startsOn: null, endsOn: null })} />
            {hasDates && (
              <>
                <DatePicker title="С" selection={fromDateTime(d.startsOn ?? today(), '12:00')} displayedComponents={['date']} onDateChange={(date) => set({ startsOn: toDateString(date) })} />
                <Toggle label="Есть дата окончания" isOn={d.endsOn !== null} onIsOnChange={(on) => set({ endsOn: on ? (d.startsOn ?? today()) : null })} />
                {d.endsOn !== null && <DatePicker title="По" selection={fromDateTime(d.endsOn, '12:00')} displayedComponents={['date']} onDateChange={(date) => set({ endsOn: toDateString(date) })} />}
              </>
            )}
          </Section>

          <Section title="Условия" footer={<Text>Сумма — позиции чека до скидок. Количество — сколько штук подходящих позиций.</Text>}>
            <InputRow label="От суммы чека, ₽" value={d.minCheckSum ? String(d.minCheckSum) : ''} placeholder="без порога" keyboard="decimal-pad" onChange={(v) => set({ minCheckSum: num(v) })} />
            {!free && <InputRow label="От количества, шт." value={d.minQuantity && d.minQuantity > 1 ? String(d.minQuantity) : ''} placeholder="1" keyboard="numeric" onChange={(v) => set({ minQuantity: Math.max(1, Math.round(num(v))) })} />}
          </Section>

          {existing ? (
            <Section>
              <ActionRow title="Удалить скидку" icon="trash" destructive onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}

/** Подсказка к «N-й бесплатно»: как это увидит гость. */
function freeHint(every: number | null, history: boolean): string {
  if (!every || every < 2) return 'Укажите, какая по счёту позиция бесплатна — от 2.';
  if (history) return `Штамп-карта: гость копит покупки из разных визитов, каждая ${every}-я — в подарок. Считаются покупки с момента создания скидки.`;
  return every === 2 ? 'В одном чеке: из двух подходящих позиций дешёвая — бесплатно.' : `В одном чеке: каждая ${every}-я подходящая позиция бесплатна (самая дешёвая).`;
}
