import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { ActionRow, LinkRow } from '@/components/native-form';
import { AUDIENCE_INFO, useTelegramChat, type ChatCommand, type CommandAccess } from '@/lib/telegram-api';
import { colors } from '@/lib/theme';

const COOLDOWNS = [0, 5, 10, 30, 60];
const MAX_COMMANDS = 40;

type KindIcon =
  | 'at'
  | 'text.bubble.fill'
  | 'list.bullet.rectangle.fill'
  | 'questionmark.circle.fill'
  | 'dot.radiowaves.left.and.right'
  | 'calendar'
  | 'sparkles'
  | 'dice.fill'
  | 'checklist';
const KIND_ICON: Record<ChatCommand['kind'], { icon: KindIcon; color: string }> = {
  mention: { icon: 'at', color: '#FF2D55' },
  text: { icon: 'text.bubble.fill', color: '#0A84FF' },
  rules: { icon: 'list.bullet.rectangle.fill', color: '#34C759' },
  help: { icon: 'questionmark.circle.fill', color: '#8E8E93' },
  stream: { icon: 'dot.radiowaves.left.and.right', color: '#FF3B30' },
  games: { icon: 'calendar', color: '#FF9500' },
  tai: { icon: 'sparkles', color: '#8B5CF6' },
  random: { icon: 'dice.fill', color: '#30B0C7' },
  poll: { icon: 'checklist', color: '#FF3B30' },
};

/** Что делает команда — второй строкой. */
function commandSubtitle(cmd: ChatCommand): string {
  const what =
    cmd.kind === 'mention'
      ? `Отмечает: ${AUDIENCE_INFO[cmd.audience ?? 'all'].toLowerCase()}`
      : cmd.kind === 'random'
        ? `Выбирает одного: ${AUDIENCE_INFO[cmd.audience ?? 'all'].toLowerCase()}`
        : cmd.description;
  return cmd.aliases.length ? `${what} · ${cmd.aliases.join(', ')}` : what;
}

/**
 * Команды одного чата: кто может их вызывать, как часто, и сам список — встроенные
 * отметки и справка плюс свои. Меню «/» в Telegram обновляется само.
 */
export default function ChatCommandsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.isError ? <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" /> : <ProgressView />}
      </Host>
    );
  }

  const { commands, welcome } = detail.config;
  const open = (commandId?: string) => router.push({ pathname: '/manage/telegram/command', params: commandId ? { id, commandId } : { id } });

  return (
    <>
      <Stack.Title>Команды</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Кто может вызывать" footer={<Text>Справку, правила, стрим, игры и опрос может вызвать любой. Администраторы чата не ждут паузу между командами.</Text>}>
            <Picker selection={commands.access} onSelectionChange={(value) => editor.save({ commands: { access: value as CommandAccess } })} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('admins')]}>Админы чата</Text>
              <Text modifiers={[tag('everyone')]}>Все участники</Text>
            </Picker>
            <Picker
              label="Пауза между вызовами"
              selection={commands.cooldownMin}
              onSelectionChange={(value) => editor.save({ commands: { cooldownMin: Number(value) } })}
              modifiers={[pickerStyle('menu')]}>
              {COOLDOWNS.map((min) => (
                <Text key={min} modifiers={[tag(min)]}>
                  {min ? `${min} мин` : 'Без паузы'}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title="Команды" footer={<Text>Вызываются как /команда или словом из «других названий», например @all. Меню «/» в Telegram обновляется само.</Text>}>
            {commands.list.map((cmd) => (
              <LinkRow
                key={cmd.id}
                icon={KIND_ICON[cmd.kind].icon}
                color={cmd.enabled ? KIND_ICON[cmd.kind].color : '#C7C7CC'}
                title={`/${cmd.name}`}
                subtitle={commandSubtitle(cmd)}
                value={!cmd.enabled ? 'Выкл.' : cmd.kind === 'rules' && !welcome.rules.trim() ? 'нет правил' : undefined}
                valueColor={cmd.enabled ? colors.orange : undefined}
                onPress={() => open(cmd.id)}
              />
            ))}
            {commands.list.length < MAX_COMMANDS ? <ActionRow title="Новая команда" icon="plus.circle.fill" onPress={() => open()} /> : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}
