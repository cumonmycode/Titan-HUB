import { DatePicker, Form, Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost, InputRow, LinkRow } from '@/components/native-form';
import { chooseAction } from '@/lib/dialog';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { formatMoney } from '@/lib/format';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { CERT_SCOPE_LABEL, issueCertificate, issueSeries, seriesPreview, usePickDraft, type CertificateScope } from '@/lib/loyalty-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const int = (text: string) => {
  const n = Number(text.replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const SERIES_MAX = 1000;
const DEFAULT_VALID_DAYS = 90;
const CODE_RE = /^[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]{2,39}$/;

/**
 * Выпуск сертификатов: один — со своим номером (с напечатанной карточки) или сгенерированным,
 * либо серия диапазоном «TK-0001…TK-0100». Номинал, на что действует, срок и получатель.
 */
export default function NewCertificateScreen() {
  const router = useRouter();
  const goods = useGoods();
  const startPick = usePickDraft((s) => s.start);
  const [mode, setMode] = useState<'one' | 'series'>('one');
  const [code, setCode] = useState('');
  const [prefix, setPrefix] = useState('TK-');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(50);
  const [pad, setPad] = useState(4);
  const [skipExisting, setSkipExisting] = useState(false);
  const [nominal, setNominal] = useState(0);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<CertificateScope>('all');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const count = to - from + 1;
  const codeTyped = code.trim().toUpperCase().replace(/\s+/g, '');
  const codeBad = mode === 'one' && !!codeTyped && !CODE_RE.test(codeTyped);
  const seriesBad = mode === 'series' && (count < 1 || count > SERIES_MAX);
  const scopeEmpty = (scope === 'categories' && !categoryIds.length) || (scope === 'items' && !itemIds.length);
  const ready = nominal > 0 && !codeBad && !seriesBad && !scopeEmpty;

  const picked = scope === 'categories' ? categoryIds : itemIds;
  const pickedNames = picked
    .map((id) => (scope === 'categories' ? goods.data?.categories.find((c) => c.id === id)?.name : goods.data?.byId.get(id)?.name))
    .filter(Boolean)
    .join(', ');

  const terms = () => ({
    nominal,
    title: title.trim() || null,
    scope,
    categoryIds: scope === 'categories' ? categoryIds : [],
    itemIds: scope === 'items' ? itemIds : [],
    validUntil,
    recipient: recipient.trim() || null,
    note: note.trim() || null,
  });

  const save = async () => {
    if (!ready || busy) return;
    haptic.medium();
    setBusy(true);
    try {
      if (mode === 'one') {
        const cert = await issueCertificate({ ...terms(), ...(codeTyped ? { code: codeTyped } : {}) });
        haptic.success();
        router.back();
        chooseAction(`Сертификат ${cert.code}`, `На ${formatMoney(cert.amount)} — готов. Отправить получателю?`, [
          { text: 'Готово', style: 'cancel' },
          { text: 'Поделиться', onPress: () => void Share.share({ message: [`Подарочный сертификат № ${cert.code}`, cert.title, `на ${formatMoney(cert.amount)}`].filter(Boolean).join('\n') }) },
        ]);
      } else {
        const r = await issueSeries({ ...terms(), recipient: null, prefix, from, to, pad, skipExisting });
        haptic.success();
        router.back();
        Alert.alert(`Серия ${r.series}`, `Выпущено ${r.created}${r.first ? `: ${r.first} … ${r.last}` : ''}.${r.skipped.length ? ` Пропущено занятых: ${r.skipped.length}.` : ''}`);
      }
    } catch (error) {
      haptic.error();
      Alert.alert('Не выпущено', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const pick = (kind: 'categories' | 'items') => {
    startPick(kind, kind === 'categories' ? categoryIds : itemIds, kind === 'categories' ? setCategoryIds : setItemIds);
    router.push('/manage/loyalty/pick');
  };

  return (
    <>
      <EditorToolbar title="Выпуск" canSave={ready} busy={busy} saveLabel={mode === 'series' && count > 1 ? `Выпустить ${count}` : 'Выпустить'} busyLabel="Выпускаем…" onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section>
            <Picker selection={mode} onSelectionChange={(v) => setMode(v as 'one' | 'series')} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('one')]}>Один</Text>
              <Text modifiers={[tag('series')]}>Серия номеров</Text>
            </Picker>
          </Section>

          {mode === 'one' ? (
            <Section title="Номер" footer={<Text>{codeBad ? 'Номер — буквы, цифры и дефис, от 3 до 40 знаков.' : 'Свой номер (например, с напечатанной карточки) или пусто — придумаем сами.'}</Text>}>
              <FieldRow value={code} placeholder="Например, TK-777" maxLength={40} onChange={setCode} />
            </Section>
          ) : (
            <Section title="Номера" footer={<Text>{seriesBad ? `В серии от 1 до ${SERIES_MAX} номеров.` : `${seriesPreview(prefix, from, to, pad)} · ${count} шт.`}</Text>}>
              <InputRow label="Префикс" value={prefix} placeholder="TK-" maxLength={20} onChange={setPrefix} />
              <InputRow label="С номера" value={String(from)} keyboard="numeric" onChange={(v) => setFrom(int(v))} />
              <InputRow label="По номер" value={String(to)} keyboard="numeric" onChange={(v) => setTo(int(v))} />
              <InputRow label="Цифр в номере" value={String(pad)} keyboard="numeric" maxLength={1} onChange={(v) => setPad(Math.min(Math.max(int(v), 1), 8))} />
              <Toggle label="Пропустить уже занятые" isOn={skipExisting} onIsOnChange={setSkipExisting} />
            </Section>
          )}

          <Section title="Номинал и название">
            <InputRow label="Номинал, ₽" value={nominal ? String(nominal) : ''} placeholder="0" keyboard="numeric" onChange={(v) => setNominal(int(v))} />
            <FieldRow value={title} placeholder="Название: «Игра для компании», «День рождения»" maxLength={80} onChange={setTitle} />
          </Section>

          <Section
            title="На что действует"
            footer={<Text>{scope === 'events' ? 'Платить можно только за мероприятие: базу события и аренду зоны.' : scope === 'all' ? 'Платить можно за всё в чеке.' : 'Платить можно только выбранными позициями — остальное гость оплатит сам.'}</Text>}>
            <Picker label="На что" selection={scope} onSelectionChange={(v) => setScope(v as CertificateScope)} modifiers={[pickerStyle('menu')]}>
              {(Object.keys(CERT_SCOPE_LABEL) as CertificateScope[]).map((k) => (
                <Text key={k} modifiers={[tag(k)]}>
                  {CERT_SCOPE_LABEL[k]}
                </Text>
              ))}
            </Picker>
            {scope === 'categories' || scope === 'items' ? (
              <LinkRow
                icon={scope === 'categories' ? 'square.grid.2x2' : 'list.bullet'}
                color="#5856D6"
                title={pickedNames || (scope === 'categories' ? 'Выбрать категории' : 'Выбрать позиции')}
                value={picked.length ? String(picked.length) : undefined}
                onPress={() => pick(scope)}
              />
            ) : null}
          </Section>

          <Section title="Срок">
            <Toggle label="Срок действия" isOn={validUntil !== null} onIsOnChange={(on) => setValidUntil(on ? toDateString(new Date(Date.now() + DEFAULT_VALID_DAYS * 86_400_000)) : null)} />
            {validUntil ? <DatePicker title="Действует до" selection={fromDateTime(validUntil, '12:00')} displayedComponents={['date']} range={{ start: new Date() }} onDateChange={(date) => setValidUntil(toDateString(date))} /> : null}
          </Section>

          <Section title="Для кого">
            {mode === 'one' ? <FieldRow value={recipient} placeholder="Получатель (необязательно)" maxLength={120} onChange={setRecipient} /> : null}
            <FieldRow value={note} placeholder="Заметка: кто купил, как оплатил" maxLength={500} onChange={setNote} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
