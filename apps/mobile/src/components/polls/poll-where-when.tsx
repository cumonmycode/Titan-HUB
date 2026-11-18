import { Button, ContentUnavailableView, DatePicker, HStack, Image, Picker, ProgressView, Section, Spacer, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, primary, TimeRow } from '@/components/native-form';
import { WEEKDAY_LABELS, type PollChat, type PollConfig } from '@/lib/admin-api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { createTopic, resolveTopicLink } from '@/lib/telegram-api';
import { colors } from '@/lib/theme';

const WEEKDAY_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MAX_TIMES = 6;
const MAX_DATES = 60;
const DAY_MS = 86_400_000;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Patch = (next: Partial<PollConfig>) => void;

/** «2026-11-20» ↔ дата: DatePicker работает с датами, опрос хранит строки по Москве. */
export const ymd = (date: Date) => new Date(date.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const fromYmd = (value: string) => new Date(`${value}T12:00:00+03:00`);
export const dateLabel = (value: string) => fromYmd(value).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });

const chatTag = (chatId: string | number, threadId: string | number | null) => `${chatId}|${threadId ?? ''}`;

/**
 * Куда выкладывать: группы и темы, которые видел бот, плюс как добавить новые —
 * бота в группу (приглашение из раздела «Telegram»), тему ботом или тему по ссылке.
 */
export function WhereSection({ draft, patch, chats, loading, refetch }: { draft: PollConfig; patch: Patch; chats: PollChat[]; loading: boolean; refetch: () => Promise<unknown> }) {
  const router = useRouter();
  const selectedChat = chats.find((chat) => String(chat.id) === String(draft.chatId));
  const select = (chatId: string, threadId: number | null) => patch({ chatId, threadId });

  const addTopic = async (chatId: string, name: string) => {
    try {
      const topic = await createTopic(chatId, name);
      await refetch();
      select(chatId, topic.threadId);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Тема не создалась', errorText(error));
    }
  };

  const newTopic = () => {
    if (!selectedChat) return;
    const chatId = String(selectedChat.id);
    promptText(
      'Новая тема',
      `Бот создаст тему в «${selectedChat.title ?? 'группе'}». Нужны включённые темы и право бота управлять ими.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Создать', onPress: (name) => (name?.trim() ? void addTopic(chatId, name.trim()) : undefined) },
      ],
      'plain-text',
      'Опросы',
    );
  };

  const addByLink = async (url: string, name?: string) => {
    try {
      const found = await resolveTopicLink(url, name);
      await refetch();
      select(found.chatId, found.threadId);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Не получилось', errorText(error));
    }
  };

  const byLink = () =>
    promptText('Тема по ссылке', 'В группе нажмите на любое сообщение в нужной теме → «Копировать ссылку» и вставьте её сюда.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Дальше',
        onPress: (url) => {
          if (!url?.trim()) return;
          promptText('Как назвать тему?', 'Название — только для списка в HUB. Можно оставить пустым.', [
            { text: 'Готово', onPress: (name) => void addByLink(url.trim(), name?.trim() || undefined) },
          ]);
        },
      },
    ]);

  return (
    <Section title="Куда выкладывать" footer={<Text>Темы форума — со стрелкой. Нет нужной группы — добавьте в неё бота; нет темы — создайте её или вставьте ссылку.</Text>}>
      {loading ? (
        <ProgressView />
      ) : chats.length === 0 ? (
        <ContentUnavailableView title="Чатов нет" systemImage="bubble.left.and.bubble.right" description="Бот ещё не добавлен ни в одну группу." />
      ) : (
        <Picker
          selection={draft.chatId ? chatTag(draft.chatId, draft.threadId) : null}
          onSelectionChange={(value) => {
            const [chatId, threadId] = String(value).split('|');
            select(chatId ?? '', threadId ? Number(threadId) : null);
          }}
          modifiers={[pickerStyle('inline')]}>
          {chats.flatMap((chat) => [
            <Text key={chatTag(chat.id, null)} modifiers={[tag(chatTag(chat.id, null))]}>
              {chat.title ?? `Чат ${chat.id}`}
            </Text>,
            ...chat.topics.map((topic) => (
              <Text key={chatTag(chat.id, topic.threadId)} modifiers={[tag(chatTag(chat.id, topic.threadId))]}>
                {`   › ${topic.name ?? `Тема ${topic.threadId}`}`}
              </Text>
            )),
          ])}
        </Picker>
      )}
      <ActionRow title="Добавить бота в группу" icon="plus.bubble" onPress={() => router.push('/manage/telegram/add')} />
      {selectedChat ? <ActionRow title={`Создать тему в «${selectedChat.title ?? 'группе'}»`} icon="number.square" onPress={newTopic} /> : null}
      <ActionRow title="Тема по ссылке" icon="link" onPress={byLink} />
    </Section>
  );
}

function scheduleFooter(byDates: boolean, dates: string[], weekdays: number[]): string {
  if (byDates) return dates.length ? 'Опрос выходит в выбранные даты. Одна дата — разовый опрос.' : 'Добавьте хотя бы одну дату.';
  return weekdays.length ? 'Опрос выходит в отмеченные дни в каждое из времён.' : 'Без выбранных дней опрос выходит только кнопкой «Выложить сегодня».';
}

/** Когда выкладывать: дни недели или даты, одно или несколько времён, пауза. */
export function WhenSection({ draft, patch }: { draft: PollConfig; patch: Patch }) {
  const [newDate, setNewDate] = useState(() => new Date(Date.now() + DAY_MS));
  const byDates = draft.scheduleKind === 'dates';
  const times = draft.times?.length ? draft.times : [draft.postTime];
  const dates = [...(draft.dates ?? [])].sort();

  const setTimes = (next: string[]) => patch({ times: next, postTime: next[0] ?? draft.postTime });
  const toggleDay = (day: number) => {
    haptic.selection();
    patch({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort((a, b) => a - b) });
  };
  const addDate = () => {
    const value = ymd(newDate);
    if (dates.includes(value)) return;
    haptic.light();
    patch({ dates: [...dates, value].sort().slice(-MAX_DATES) });
  };

  return (
    <>
      <Section title="Когда" footer={<Text>{scheduleFooter(byDates, dates, draft.weekdays)}</Text>}>
        <Picker selection={byDates ? 'dates' : 'weekly'} onSelectionChange={(value) => patch({ scheduleKind: value as 'weekly' | 'dates' })} modifiers={[pickerStyle('segmented')]}>
          <Text modifiers={[tag('weekly')]}>По дням недели</Text>
          <Text modifiers={[tag('dates')]}>По датам</Text>
        </Picker>
        {byDates
          ? dates.map((value) => (
              <HStack key={value} spacing={10}>
                <Text modifiers={[primary]}>{dateLabel(value)}</Text>
                <Spacer />
                <Image systemName="minus.circle.fill" size={20} color={colors.red} onPress={() => patch({ dates: dates.filter((d) => d !== value) })} />
              </HStack>
            ))
          : WEEKDAY_LABELS.map((label, index) => (
              <Button key={label} onPress={() => toggleDay(index + 1)}>
                <HStack spacing={10}>
                  <Text modifiers={[primary]}>{WEEKDAY_FULL[index]}</Text>
                  <Spacer />
                  {draft.weekdays.includes(index + 1) ? <Image systemName="checkmark" size={16} color={colors.accent} /> : null}
                </HStack>
              </Button>
            ))}
        {byDates ? (
          <>
            <DatePicker title="Новая дата" selection={newDate} displayedComponents={['date']} range={{ start: new Date() }} onDateChange={setNewDate} />
            <ActionRow title="Добавить дату" icon="calendar.badge.plus" onPress={addDate} />
          </>
        ) : null}
      </Section>

      <Section title="Время выкладки" footer={<Text>По Москве. Несколько времён — несколько опросов в день.</Text>}>
        {times.map((time, index) => (
          <HStack key={`${index}-${time}`} spacing={10}>
            <TimeRow label={times.length > 1 ? `Опрос ${index + 1}` : 'Время'} value={time} fallback="10:00" onChange={(next) => setTimes(times.map((t, i) => (i === index ? next : t)))} />
            {times.length > 1 ? <Image systemName="minus.circle.fill" size={20} color={colors.red} onPress={() => setTimes(times.filter((_, i) => i !== index))} /> : null}
          </HStack>
        ))}
        {times.length < MAX_TIMES ? <ActionRow title="Добавить время" icon="plus.circle" onPress={() => setTimes([...times, '18:00'])} /> : null}
      </Section>

      <Section footer={<Text>{draft.pausedUntil ? `Опрос не выйдет по ${dateLabel(draft.pausedUntil)} включительно.` : 'Например, на каникулы — опрос останется включённым.'}</Text>}>
        <Toggle label="Пауза" isOn={!!draft.pausedUntil} onIsOnChange={(on) => patch({ pausedUntil: on ? ymd(new Date(Date.now() + 7 * DAY_MS)) : null })} />
        {draft.pausedUntil ? (
          <DatePicker title="До" selection={fromYmd(draft.pausedUntil)} displayedComponents={['date']} range={{ start: new Date() }} onDateChange={(date) => patch({ pausedUntil: ymd(date) })} />
        ) : null}
      </Section>
    </>
  );
}
