import { Picker, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import { FieldRow, TimeRow } from '@/components/native-form';
import type { PollConfig } from '@/lib/admin-api';

type Patch = (next: Partial<PollConfig>) => void;

const CLOSE_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 48];
const REMIND_MINUTES = [0, 15, 30, 60, 120, 180];
const hoursLabel = (h: number) => (h === 1 ? '1 час' : h < 5 ? `${h} часа` : `${h} часов`);
const remindLabel = (m: number) => (m === 0 ? 'Не напоминать' : m < 60 ? `За ${m} мин` : `За ${m / 60} ч`);

/** Как выглядит и работает сам опрос в Telegram (Bot API 9.6+). */
export function TelegramOptionsSection({ draft, patch }: { draft: PollConfig; patch: Patch }) {
  const votesFooter = draft.anonymous
    ? 'В анонимном опросе бот не видит голоса: команды-отметки, напоминание и итоги работать не будут.'
    : 'Голоса видны боту — по ним работают @tvari, напоминание и итоги.';
  return (
    <>
      <Section title="Описание" footer={<Text>Строка под вопросом: что за игра, сколько мест, что взять с собой.</Text>}>
        <FieldRow value={draft.description ?? ''} placeholder="Необязательно" multiline maxLength={255} onChange={(description) => patch({ description })} />
      </Section>

      <Section title="Голосование" footer={<Text>{votesFooter}</Text>}>
        <Toggle label="Анонимный" isOn={draft.anonymous === true} onIsOnChange={(anonymous) => patch({ anonymous })} />
        <Toggle label="Несколько ответов" isOn={draft.multipleAnswers === true} onIsOnChange={(multipleAnswers) => patch({ multipleAnswers })} />
        <Toggle label="Можно передумать" isOn={draft.allowsRevoting !== false} onIsOnChange={(allowsRevoting) => patch({ allowsRevoting })} />
        <Toggle label="Свои варианты от участников" isOn={draft.allowAddingOptions === true} onIsOnChange={(allowAddingOptions) => patch({ allowAddingOptions })} />
        <Toggle label="Перемешивать варианты" isOn={draft.shuffleOptions === true} onIsOnChange={(shuffleOptions) => patch({ shuffleOptions })} />
        <Toggle label="Голосуют только участники чата" isOn={draft.membersOnly === true} onIsOnChange={(membersOnly) => patch({ membersOnly })} />
      </Section>
    </>
  );
}

function closeFooter(draft: PollConfig): string {
  if ((draft.closeMode ?? 'none') === 'none') return 'Опрос остаётся открытым, пока его не закроют вручную.';
  if (draft.closeMode === 'at') return 'Опрос закроется в это время по Москве; если оно уже прошло — завтра.';
  return 'Telegram сам закроет опрос через это время после выкладки.';
}

/** Закрытие, напоминание неотметившимся и итог «кто идёт». */
export function ClosingSection({ draft, patch }: { draft: PollConfig; patch: Patch }) {
  const mode = draft.closeMode ?? 'none';
  const closes = mode !== 'none';
  return (
    <>
      <Section title="Закрытие" footer={<Text>{closeFooter(draft)}</Text>}>
        <Picker selection={mode} onSelectionChange={(value) => patch({ closeMode: value as PollConfig['closeMode'] })} modifiers={[pickerStyle('segmented')]}>
          <Text modifiers={[tag('none')]}>Не закрывать</Text>
          <Text modifiers={[tag('after')]}>Через время</Text>
          <Text modifiers={[tag('at')]}>В момент</Text>
        </Picker>
        {mode === 'after' ? (
          <Picker label="Через" selection={draft.closeAfterHours ?? 6} onSelectionChange={(value) => patch({ closeAfterHours: Number(value) })} modifiers={[pickerStyle('menu')]}>
            {CLOSE_HOURS.map((h) => (
              <Text key={h} modifiers={[tag(h)]}>
                {hoursLabel(h)}
              </Text>
            ))}
          </Picker>
        ) : null}
        {mode === 'at' ? <TimeRow label="Закрыть в" value={draft.closeAtTime ?? '19:00'} fallback="19:00" onChange={(closeAtTime) => patch({ closeAtTime })} /> : null}
        {closes ? <Toggle label="Итоги только после закрытия" isOn={draft.hideResultsUntilClose === true} onIsOnChange={(hideResultsUntilClose) => patch({ hideResultsUntilClose })} /> : null}
      </Section>

      {closes && !draft.anonymous ? (
        <Section title="Перед закрытием и после" footer={<Text>Напоминание отмечает тех, кто не ответил или выбрал «Думаю». Итог — сколько и кто выбрал каждый вариант.</Text>}>
          <Picker label="Напомнить" selection={draft.remindBeforeMin ?? 0} onSelectionChange={(value) => patch({ remindBeforeMin: Number(value) })} modifiers={[pickerStyle('menu')]}>
            {REMIND_MINUTES.map((m) => (
              <Text key={m} modifiers={[tag(m)]}>
                {remindLabel(m)}
              </Text>
            ))}
          </Picker>
          <Toggle label="Итог «кто идёт» после закрытия" isOn={draft.summary === true} onIsOnChange={(summary) => patch({ summary })} />
        </Section>
      ) : null}
    </>
  );
}

/** Закреп нового опроса и уборка прошлого из этой же серии. */
export function PinSection({ draft, patch }: { draft: PollConfig; patch: Patch }) {
  return (
    <Section title="В чате" footer={<Text>Закреплять и удалять сообщения бот может с правами администратора. Прошлый опрос — предыдущая выкладка этого же опроса.</Text>}>
      <Toggle label="Закреплять новый опрос" isOn={draft.pin === true} onIsOnChange={(pin) => patch({ pin })} />
      <Toggle
        label="Откреплять прошлый"
        isOn={draft.unpinPrevious === true && !draft.deletePrevious}
        onIsOnChange={(unpinPrevious) => patch({ unpinPrevious, ...(unpinPrevious ? { deletePrevious: false } : {}) })}
      />
      <Toggle label="Удалять прошлый" isOn={draft.deletePrevious === true} onIsOnChange={(deletePrevious) => patch({ deletePrevious, ...(deletePrevious ? { unpinPrevious: false } : {}) })} />
    </Section>
  );
}
