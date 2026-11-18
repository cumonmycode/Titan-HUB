import { Form, HStack, Image, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { ClosingSection, PinSection, TelegramOptionsSection } from '@/components/polls/poll-behaviour';
import { WhenSection, WhereSection } from '@/components/polls/poll-where-when';
import { POLL_DEFAULT_OPTIONS, postPollToday, savePolls, testPoll, usePollChats, usePolls, type PollConfig } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/shift-api';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Вариант ответа со стабильным ключом: поле в строке помнит свой текст при удалении соседей. */
type Option = { key: number; text: string };

/**
 * Опрос в Telegram: куда и когда выкладывать, вопрос и варианты, как голосуют,
 * когда закрывается, напоминание и итоги, закреп. Сервер хранит все опросы одним списком.
 */
export default function PollEditSheet() {
  const { pollId } = useLocalSearchParams<{ pollId?: string }>();
  const polls = usePolls();

  if (!polls.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }

  const existing = pollId ? polls.data.configs.find((item) => item.id === pollId) : undefined;
  return <PollForm key={existing?.id ?? 'new'} all={polls.data.configs} original={existing ?? null} tokenConfigured={polls.data.tokenConfigured} />;
}

function PollForm({ all, original, tokenConfigured }: { all: PollConfig[]; original: PollConfig | null; tokenConfigured: boolean }) {
  const router = useRouter();
  const chats = usePollChats();

  const [draft, setDraft] = useState<PollConfig>(
    () =>
      original ?? {
        id: newIdempotencyKey(),
        kind: 'custom',
        enabled: false,
        chatId: '',
        threadId: null,
        title: '',
        subtitleDay: '',
        autoDay: true,
        subtitleTime: '',
        options: [...POLL_DEFAULT_OPTIONS],
        weekdays: [],
        postTime: '10:00',
      },
  );
  const [options, setOptions] = useState<Option[]>(() => draft.options.map((text, key) => ({ key, text })));
  const [nextKey, setNextKey] = useState(draft.options.length);
  const [busy, setBusy] = useState<'save' | 'test' | 'today' | null>(null);

  const patch = (next: Partial<PollConfig>) => setDraft((current) => ({ ...current, ...next }));
  const filled = options.map((o) => o.text.trim()).filter(Boolean);

  const problem = (): string | null => {
    if (!draft.title.trim()) return 'Укажите название опроса';
    if (!draft.chatId.trim()) return 'Выберите чат';
    if (filled.length < 1) return 'Нужен хотя бы один вариант ответа';
    if (!(draft.times?.length ? draft.times : [draft.postTime]).every((t) => TIME_RE.test(t))) return 'Время выкладки в формате ЧЧ:ММ';
    if (draft.scheduleKind === 'dates' && !draft.dates?.length) return 'Добавьте хотя бы одну дату выкладки';
    return null;
  };

  /** Сервер принимает список целиком — подменяем в нём текущий опрос. */
  const nextList = (): PollConfig[] => {
    const clean: PollConfig = { ...draft, title: draft.title.trim(), chatId: draft.chatId.trim(), options: filled };
    return all.some((item) => item.id === clean.id) ? all.map((item) => (item.id === clean.id ? clean : item)) : [...all, clean];
  };

  const save = async (after?: (pollId: string) => Promise<void>, mode: 'save' | 'test' | 'today' = 'save') => {
    const issue = problem();
    if (issue) return Alert.alert(issue);
    haptic.medium();
    setBusy(mode);
    try {
      await savePolls(nextList());
      if (after) await after(draft.id);
      haptic.success();
      if (!after) router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не удалось', errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    original &&
    Alert.alert(`Удалить «${original.title || 'опрос'}»?`, 'Бот перестанет выкладывать этот опрос.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void savePolls(all.filter((item) => item.id !== original.id))
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Опрос не удалён', errorText(error))),
      },
    ]);

  // Вернулись из «Добавить бота в группу» — подтягиваем новые группы и темы.
  const refetchChats = chats.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchChats();
    }, [refetchChats]),
  );

  return (
    <>
      <EditorToolbar title={original ? 'Опрос' : 'Новый опрос'} canSave={!problem()} busy={busy === 'save'} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Название">
            <FieldRow value={draft.title} placeholder="Например, «Спортивная мафия»" autoFocus={!original} maxLength={120} onChange={(title) => patch({ title })} />
          </Section>

          <Section footer={<Text>Бот выкладывает включённый опрос по расписанию.</Text>}>
            <Toggle label="Опрос включён" isOn={draft.enabled} onIsOnChange={(enabled) => patch({ enabled })} />
          </Section>

          <WhereSection draft={draft} patch={patch} chats={chats.data ?? []} loading={chats.isLoading} refetch={chats.refetch} />

          <WhenSection draft={draft} patch={patch} />

          <Section title="Подзаголовок" footer={<Text>Строка под заголовком опроса: день и время игры.</Text>}>
            <Toggle label="День недели автоматически" isOn={draft.autoDay !== false} onIsOnChange={(autoDay) => patch({ autoDay })} />
            {draft.autoDay === false && <FieldRow value={draft.subtitleDay} placeholder="День, например «Пятница»" onChange={(subtitleDay) => patch({ subtitleDay })} />}
            <FieldRow value={draft.subtitleTime} placeholder="Время игры, например «20:00»" onChange={(subtitleTime) => patch({ subtitleTime })} />
          </Section>

          <Section title="Варианты ответа" footer={<Text>От одного до десяти вариантов. Пустые строки не сохраняются.</Text>}>
            {options.map((option, index) => (
              <HStack key={option.key} spacing={10}>
                <FieldRow value={option.text} placeholder={`Вариант ${index + 1}`} onChange={(text) => setOptions((list) => list.map((o) => (o.key === option.key ? { ...o, text } : o)))} />
                {options.length > 1 ? (
                  <Image
                    systemName="minus.circle.fill"
                    size={20}
                    color={colors.red}
                    onPress={() => {
                      haptic.light();
                      setOptions((list) => list.filter((o) => o.key !== option.key));
                    }}
                  />
                ) : null}
              </HStack>
            ))}
            {options.length < 10 && (
              <ActionRow
                title="Добавить вариант"
                icon="plus.circle.fill"
                onPress={() => {
                  setOptions((list) => [...list, { key: nextKey, text: '' }]);
                  setNextKey((k) => k + 1);
                }}
              />
            )}
          </Section>

          <TelegramOptionsSection draft={draft} patch={patch} />
          <ClosingSection draft={draft} patch={patch} />
          <PinSection draft={draft} patch={patch} />

          <Section footer={<Text>{tokenConfigured ? 'Перед отправкой опрос сохраняется.' : 'Токен бота опросов не задан — отправить не получится.'}</Text>}>
            <ActionRow
              title={busy === 'test' ? 'Отправляем…' : 'Отправить тестовый опрос'}
              icon="paperplane"
              disabled={!!busy}
              onPress={() => void save((id) => testPoll(id).then(() => Alert.alert('Тестовый опрос отправлен')), 'test')}
            />
            <ActionRow
              title={busy === 'today' ? 'Выкладываем…' : 'Выложить сегодня'}
              icon="megaphone"
              disabled={!!busy}
              onPress={() => void save((id) => postPollToday(id).then(() => Alert.alert('Опрос выложен', 'Плановая выкладка сегодня уже не повторится.')), 'today')}
            />
          </Section>

          {original && (
            <Section>
              <ActionRow title="Удалить опрос" icon="trash" destructive onPress={remove} />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
