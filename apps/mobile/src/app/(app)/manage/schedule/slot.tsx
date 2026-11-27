import { DatePicker, Form, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, TimeRow } from '@/components/native-form';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { newSlotId, saveSchedule, useSchedule, WEEKDAY_NAMES, type Schedule, type ScheduleSlot } from '@/lib/schedule-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const DEFAULT_TIME = '19:00';
const DEFAULT_POST_TIME = '10:00';
const NO_CHAT = '';
const chatValue = (chatId: string | null | undefined, threadId: number | null | undefined) => (chatId ? `${chatId}|${threadId ?? ''}` : NO_CHAT);

/** Вечер расписания: без id — новый (repeat=weekly|once из «+»). */
export default function SlotEditor() {
  const { id, repeat } = useLocalSearchParams<{ id?: string; repeat?: 'weekly' | 'once' }>();
  const schedule = useSchedule();
  if (!schedule.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  const original = id ? (schedule.data.slots.find((s) => s.id === id) ?? null) : null;
  return <SlotForm key={original?.id ?? 'new'} schedule={schedule.data} original={original} repeat={original?.repeat ?? (repeat === 'once' ? 'once' : 'weekly')} />;
}

function SlotForm({ schedule, original, repeat }: { schedule: Schedule; original: ScheduleSlot | null; repeat: 'weekly' | 'once' }) {
  const router = useRouter();
  const types = schedule.eveningTypes;
  const firstType = types.find((t) => t.key === 'city_mafia') ?? types[0];
  const [draft, setDraft] = useState<ScheduleSlot>(
    () =>
      original ?? {
        id: newSlotId(),
        repeat,
        day: repeat === 'weekly' ? 5 : null,
        date: repeat === 'once' ? toDateString(new Date()) : null,
        evening: firstType?.key ?? 'city_mafia',
        title: firstType?.label ?? 'Городская мафия',
        time: DEFAULT_TIME,
        end: null,
        onSite: true,
        note: null,
        poll: { on: false },
      },
  );
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<ScheduleSlot>) => setDraft((d) => ({ ...d, ...next }));
  const labelOf = (key: string) => types.find((t) => t.key === key)?.label ?? '';

  // Опрос — в чат бота: чат целиком или его тема (форум).
  const chatOptions = schedule.chats.flatMap((c) => [
    { value: chatValue(c.id, null), label: c.title ?? `Чат ${c.id}` },
    ...c.topics.map((t) => ({ value: chatValue(c.id, Number(t.threadId)), label: `${c.title ?? 'Чат'} · ${t.name ?? `тема ${t.threadId}`}` })),
  ]);

  const problem = (): string | null => {
    if (!draft.title.trim()) return 'Укажите название';
    if (draft.poll.on && !draft.poll.chatId) return 'Выберите чат для опроса';
    return null;
  };

  const commit = async (slots: ScheduleSlot[], failTitle: string) => {
    setBusy(true);
    try {
      await saveSchedule(slots);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(failTitle, errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const issue = problem();
    if (issue) {
      Alert.alert(issue);
      return;
    }
    haptic.medium();
    const slot: ScheduleSlot = { ...draft, title: draft.title.trim(), note: draft.note?.trim() || null };
    const slots = original ? schedule.slots.map((s) => (s.id === original.id ? slot : s)) : [...schedule.slots, slot];
    void commit(slots, 'Не сохранилось');
  };

  const remove = () => {
    if (!original) return;
    Alert.alert('Убрать из расписания?', `${draft.title}. Сайт, Tai и касса перестанут его учитывать${draft.poll.on ? ', опрос в чат больше не выйдет' : ''}.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void commit(schedule.slots.filter((s) => s.id !== original.id), 'Не убрано') },
    ]);
  };

  const pollHint =
    draft.repeat === 'weekly'
      ? `Каждый ${(WEEKDAY_NAMES[draft.day ?? 5] ?? '').toLowerCase()} в ${draft.poll.postTime ?? DEFAULT_POST_TIME}`
      : `В день события в ${draft.poll.postTime ?? DEFAULT_POST_TIME}`;

  return (
    <>
      <EditorToolbar title={original ? draft.title : repeat === 'once' ? 'Разовое событие' : 'Вечер недели'} canSave={!problem()} busy={busy} onSave={save} />
      <FormHost>
        <Form>
          <Section title="Когда">
            {draft.repeat === 'weekly' ? (
              <Picker
                label="День"
                selection={draft.day ?? 5}
                onSelectionChange={(next) => {
                  haptic.selection();
                  patch({ day: Number(next) });
                }}
                modifiers={[pickerStyle('menu')]}>
                {WEEKDAY_NAMES.slice(1).map((name, k) => (
                  <Text key={name} modifiers={[tag(k + 1)]}>
                    {name}
                  </Text>
                ))}
              </Picker>
            ) : (
              <DatePicker
                title="Дата"
                selection={fromDateTime(draft.date ?? toDateString(new Date()), '12:00')}
                displayedComponents={['date']}
                onDateChange={(d) => patch({ date: toDateString(d) })}
              />
            )}
            <TimeRow label="Начало" value={draft.time} fallback={DEFAULT_TIME} onChange={(time) => patch({ time })} />
          </Section>

          <Section title="Что" footer={<Text>Тип вечера — для кассы и статистики; название видят гости на сайте и Tai. Свой тип («Хэллоуин») — в «Тарифы и аренда».</Text>}>
            <Picker
              label="Тип вечера"
              selection={draft.evening}
              onSelectionChange={(next) => {
                haptic.selection();
                const key = String(next);
                // Название шло за типом — меняем вместе; своё название не трогаем.
                const followed = draft.title.trim() === labelOf(draft.evening);
                patch({ evening: key, ...(followed || !draft.title.trim() ? { title: labelOf(key) } : {}) });
              }}
              modifiers={[pickerStyle('menu')]}>
              {types.map((t) => (
                <Text key={t.key} modifiers={[tag(t.key)]}>
                  {t.label}
                </Text>
              ))}
            </Picker>
            <FieldRow value={draft.title} placeholder="Название для гостей" maxLength={60} onChange={(title) => patch({ title })} />
          </Section>

          <Section title="Где видно" footer={draft.poll.on ? <Text>{`${pollHint}. Варианты ответа, закрепление и закрытие — в «Управление → Опросы».`}</Text> : undefined}>
            <Toggle label="На сайте" isOn={draft.onSite} onIsOnChange={(onSite) => patch({ onSite })} />
            <Toggle
              label="Опрос записи в Telegram"
              isOn={draft.poll.on}
              onIsOnChange={(on) => {
                const [firstChat, firstThread] = (chatOptions[0]?.value ?? '').split('|');
                patch({
                  poll: {
                    ...draft.poll,
                    on,
                    postTime: draft.poll.postTime ?? DEFAULT_POST_TIME,
                    chatId: draft.poll.chatId ?? (on && firstChat ? firstChat : null),
                    threadId: draft.poll.chatId ? draft.poll.threadId : on && firstThread ? Number(firstThread) : null,
                  },
                });
              }}
            />
            {draft.poll.on ? (
              <Picker
                label="Чат"
                selection={chatValue(draft.poll.chatId, draft.poll.threadId)}
                onSelectionChange={(next) => {
                  const [chatId, thread] = String(next).split('|');
                  patch({ poll: { ...draft.poll, chatId: chatId || null, threadId: thread ? Number(thread) : null } });
                }}
                modifiers={[pickerStyle('menu')]}>
                {chatOptions.length ? (
                  chatOptions.map((c) => (
                    <Text key={c.value} modifiers={[tag(c.value)]}>
                      {c.label}
                    </Text>
                  ))
                ) : (
                  <Text modifiers={[tag(NO_CHAT)]}>Бот ещё не в чатах</Text>
                )}
              </Picker>
            ) : null}
            {draft.poll.on ? (
              <TimeRow label="Выложить в" value={draft.poll.postTime ?? DEFAULT_POST_TIME} fallback={DEFAULT_POST_TIME} onChange={(postTime) => patch({ poll: { ...draft.poll, postTime } })} />
            ) : null}
          </Section>

          <Section title="Заметка" footer={<Text>Видна только в HUB.</Text>}>
            <FieldRow value={draft.note ?? ''} placeholder="Например: ведущий — Тигран" multiline maxLength={300} onChange={(note) => patch({ note })} />
          </Section>

          {original ? (
            <Section>
              <ActionRow title="Убрать из расписания" icon="minus.circle" destructive disabled={busy} onPress={remove} />
            </Section>
          ) : null}
        </Form>
      </FormHost>
    </>
  );
}
