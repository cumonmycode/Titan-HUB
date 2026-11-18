import { Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Share } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';
import { createInvite, invalidateTelegram, MODE_INFO, MODES, readInvite, type ChatMode } from '@/lib/telegram-api';
import { useAccentHex } from '@/lib/theme';

const POLL_MS = 2000;

type Invite = { code: string; url: string; appUrl: string; mode: ChatMode };

/**
 * Добавить бота в новый чат: выбрать назначение → Telegram откроет выбор группы и
 * прав → бот придёт уже с настройками этого назначения. Экран ждёт, пока бот
 * окажется в группе, и предлагает сразу её настроить.
 */
export default function AddChatScreen() {
  const router = useRouter();
  const club = useClubKey();
  const accent = useAccentHex();
  const [mode, setMode] = useState<ChatMode>('game');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);

  const status = useQuery({
    queryKey: [club, 'telegram', 'invite', invite?.code],
    queryFn: () => readInvite(invite!.code),
    enabled: !!invite,
    refetchInterval: (query) => (query.state.data?.chatId ? false : POLL_MS),
  });
  const joined = status.data?.chatId ? { id: status.data.chatId, title: status.data.title } : null;

  const openTelegram = async (link: Invite) => {
    try {
      await Linking.openURL(link.appUrl);
    } catch {
      await Linking.openURL(link.url).catch(() => Alert.alert('Не удалось открыть Telegram', 'Поделитесь ссылкой и откройте её в Telegram.'));
    }
  };

  const start = async () => {
    setBusy(true);
    try {
      const created = { ...(await createInvite(mode)), mode };
      setInvite(created);
      haptic.success();
      await openTelegram(created);
    } catch (error) {
      haptic.error();
      Alert.alert('Ссылка не создалась', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const configure = () => {
    if (!joined) return;
    void invalidateTelegram(club);
    router.replace({ pathname: '/manage/telegram/chat', params: { id: joined.id } });
  };

  if (joined && invite) {
    const info = MODE_INFO[invite.mode];
    return (
      <>
        <Stack.Title>Бот добавлен</Stack.Title>
        <Host style={{ flex: 1 }} useViewportSizeMeasurement>
          <Form>
            <Section footer={<Text>{`Бот уже поздоровался в чате и включил настройки «${info.title}». Их можно поменять в любой момент.`}</Text>}>
              <LinkRow icon="checkmark.circle.fill" color="#34C759" title={joined.title || 'Новый чат'} subtitle={info.title} chevron={false} />
            </Section>
            <Section>
              <ActionRow title="Настроить чат" icon="slider.horizontal.3" onPress={configure} />
            </Section>
          </Form>
        </Host>
      </>
    );
  }

  return (
    <>
      <Stack.Title>Добавить в чат</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Для чего чат" footer={<Text>{MODE_INFO[mode].about}</Text>}>
            {MODES.map((key) => {
              const selected = key === mode;
              return (
                <LinkRow
                  key={key}
                  icon={selected ? 'checkmark.circle.fill' : MODE_INFO[key].icon}
                  color={selected ? accent : MODE_INFO[key].color}
                  title={MODE_INFO[key].title}
                  chevron={false}
                  onPress={invite ? undefined : () => setMode(key)}
                />
              );
            })}
          </Section>

          {invite ? (
            <Section
              title="Ждём бота в чате"
              footer={<Text>Выберите группу в Telegram и подтвердите права. Если группу добавляет другой администратор — отправьте ему ссылку, она действует сутки.</Text>}>
              <ProgressView />
              <ActionRow title="Открыть Telegram снова" icon="paperplane.fill" onPress={() => void openTelegram(invite)} />
              <ActionRow title="Поделиться ссылкой" icon="square.and.arrow.up" onPress={() => void Share.share({ message: invite.url })} />
              <ActionRow title="Выбрать другое назначение" icon="arrow.uturn.backward" onPress={() => setInvite(null)} />
            </Section>
          ) : (
            <Section footer={<Text>Откроется Telegram: выберите группу или создайте новую. Бот попросит права администратора — так он увидит всех участников и сможет закреплять правила.</Text>}>
              <ActionRow title={busy ? 'Готовим ссылку…' : 'Открыть Telegram'} icon="paperplane.fill" disabled={busy} onPress={() => void start()} />
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
