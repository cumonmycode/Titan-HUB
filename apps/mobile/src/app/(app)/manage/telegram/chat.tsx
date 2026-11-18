import { ContentUnavailableView, Form, Host, Picker, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';
import { invalidateTelegram, isGroupGone, MODE_INFO, MODES, removeChat, testChat, useTelegramChat, type ChatDetail, type ChatMode } from '@/lib/telegram-api';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type ChatSubscreen = '/manage/telegram/tai' | '/manage/telegram/commands' | '/manage/telegram/notify' | '/manage/telegram/welcome';

/** Чего не хватает боту в правах — одной фразой под шапкой. */
function rightsHint(detail: ChatDetail): string | null {
  const live = detail.live;
  if (!live || !live.reachable) return null;
  if (!live.rights.admin) return 'Бот — обычный участник: он не видит сообщения без обращения и не знает всех в чате. Сделайте его администратором в настройках группы.';
  const missing = [
    !live.rights.pinMessages ? 'закреплять сообщения' : null,
    !live.rights.deleteMessages ? 'удалять сообщения' : null,
    live.isForum && !live.rights.manageTopics ? 'управлять темами' : null,
  ].filter(Boolean);
  return missing.length ? `Боту не хватает прав: ${missing.join(', ')}.` : null;
}

/**
 * Один чат: назначение и всё, что бот в нём делает — Tai, команды, уведомления,
 * приветствие и правила, опросы. Каждое — своим экраном, здесь — сводка.
 */
export default function TelegramChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const club = useClubKey();
  const editor = useTelegramChat(id);
  const [testing, setTesting] = useState(false);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.isError ? (
          <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" description={errorText(editor.query.error)} />
        ) : (
          <ProgressView />
        )}
      </Host>
    );
  }

  const { config, chat } = detail;
  const liveGone = detail.live?.reachable === true && (detail.live.status === 'left' || detail.live.status === 'kicked');
  const gone = isGroupGone(config.bot.status) || liveGone;
  const title = chat.title || 'Чат';
  const go = (pathname: ChatSubscreen) => router.push({ pathname, params: { id } });

  const notifyOn = detail.categories.filter((c) => config.notify[c.key].on);
  const commandsOn = config.commands.list.filter((c) => c.enabled).length;
  const hint = gone ? null : rightsHint(detail);

  const sendTest = async () => {
    setTesting(true);
    try {
      await testChat(id, null);
      haptic.success();
      Alert.alert('Отправлено', 'Проверьте чат в Telegram.');
    } catch (error) {
      haptic.error();
      Alert.alert('Не отправилось', errorText(error));
    } finally {
      setTesting(false);
    }
  };

  const remove = () =>
    Alert.alert(
      gone ? `Убрать «${title}» из списка?` : `Удалить бота из «${title}»?`,
      gone ? 'Настройки чата удалятся.' : 'Бот выйдет из группы, настройки чата удалятся. Вернуть можно кнопкой «Добавить бота в чат».',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: gone ? 'Убрать' : 'Удалить',
          style: 'destructive',
          onPress: () =>
            void removeChat(id, !gone).then(
              () => {
                haptic.success();
                void invalidateTelegram(club);
                router.back();
              },
              (error: unknown) => Alert.alert('Не получилось', errorText(error)),
            ),
        },
      ],
    );

  return (
    <>
      <Stack.Title>{title}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await editor.query.refetch()))]}>
          <Section footer={hint ? <Text>{hint}</Text> : undefined}>
            <RNHostView matchContents>
              <ChatHero detail={detail} gone={gone} />
            </RNHostView>
          </Section>

          {gone ? null : (
            <>
              <Section title="Назначение" footer={<Text>{MODE_INFO[config.mode].about}</Text>}>
                <Picker selection={config.mode} onSelectionChange={(value) => editor.save({ mode: value as ChatMode })} modifiers={[pickerStyle('segmented')]}>
                  {MODES.map((mode) => (
                    <Text key={mode} modifiers={[tag(mode)]}>
                      {MODE_INFO[mode].short}
                    </Text>
                  ))}
                </Picker>
              </Section>

              <Section title="Что делает бот">
                {config.mode !== 'notify' ? (
                  <LinkRow
                    icon="sparkles"
                    color="#8B5CF6"
                    title="Tai в чате"
                    subtitle={config.mode === 'work' ? 'Отвечает сотрудникам по работе' : 'Шутит, когда к нему обращаются'}
                    value={config.tai.on ? detail.presets.find((p) => p.key === config.tai.preset)?.label : 'Молчит'}
                    onPress={() => go('/manage/telegram/tai')}
                  />
                ) : null}
                <LinkRow icon="command" color="#5856D6" title="Команды" subtitle="Отметки, правила, свои ответы" value={commandsOn ? String(commandsOn) : 'Нет'} onPress={() => go('/manage/telegram/commands')} />
                <LinkRow
                  icon="bell.badge.fill"
                  color="#FF9500"
                  title="Уведомления"
                  subtitle={notifyOn.length ? notifyOn.map((c) => c.title).join(', ') : 'Какие события клуба присылать'}
                  value={notifyOn.length ? String(notifyOn.length) : 'Нет'}
                  onPress={() => go('/manage/telegram/notify')}
                />
                <LinkRow
                  icon="hand.wave.fill"
                  color="#34C759"
                  title="Приветствие и правила"
                  subtitle="Новичкам и по команде /rules"
                  value={config.welcome.on ? 'Вкл.' : 'Выкл.'}
                  onPress={() => go('/manage/telegram/welcome')}
                />
              </Section>

              <Section
                title="Опросы"
                footer={<Text>{detail.polls.length ? 'Бот выкладывает их сюда по расписанию.' : 'Опросы на игры выкладываются по расписанию — создайте опрос и выберите этот чат.'}</Text>}>
                {detail.polls.map((poll) => (
                  <LinkRow
                    key={poll.id}
                    icon="checklist"
                    color={poll.enabled ? '#FF3B30' : '#8E8E93'}
                    title={poll.title || 'Без названия'}
                    value={poll.enabled ? undefined : 'Выкл.'}
                    onPress={() => router.push({ pathname: '/manage/polls/edit', params: { pollId: poll.id } })}
                  />
                ))}
                <ActionRow title="Новый опрос" icon="plus.circle.fill" onPress={() => router.push('/manage/polls/edit')} />
              </Section>

              <Section>
                <ActionRow title={testing ? 'Отправляем…' : 'Проверить связь'} icon="paperplane" disabled={testing} onPress={() => void sendTest()} />
              </Section>
            </>
          )}

          <Section>
            <ActionRow title={gone ? 'Убрать из списка' : 'Удалить бота из чата'} icon={gone ? 'trash' : 'rectangle.portrait.and.arrow.right'} destructive onPress={remove} />
          </Section>
        </Form>
      </Host>
    </>
  );
}

/** Шапка чата: назначение, участники и что бот может в нём сейчас. */
function ChatHero({ detail, gone }: { detail: ChatDetail; gone: boolean }) {
  const info = MODE_INFO[detail.config.mode];
  const live = detail.live;
  const reachable = live?.reachable === true ? live : null;
  const members = reachable?.members ? `${reachable.members} участн.` : null;
  const role = gone ? 'Бота удалили из чата' : reachable ? (reachable.rights.admin ? 'Бот — администратор' : 'Бот — участник') : 'Telegram не ответил';
  const roleColor = gone ? colors.red : reachable?.rights.admin ? colors.green : colors.orange;
  const meta = [info.title, members, reachable?.isForum ? 'с темами' : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.hero}>
      <View style={[styles.icon, { backgroundColor: gone ? '#8E8E93' : info.color }]}>
        <SymbolView name={info.icon} size={26} weight="semibold" tintColor="white" />
      </View>
      <View style={styles.flex}>
        <RNText style={[type.title3, styles.label]} numberOfLines={2}>
          {detail.chat.title || 'Чат'}
        </RNText>
        <RNText style={[type.subhead, styles.secondary]}>{meta}</RNText>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: roleColor }]} />
          <RNText style={[type.caption1, styles.secondary]}>{role}</RNText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  icon: { width: 56, height: 56, borderRadius: 15, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
