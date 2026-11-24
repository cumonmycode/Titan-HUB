import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { TaiMark } from '@/components/tai/mark';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';
import { invalidateTelegram, MODE_INFO, MODES, repairWebhook, useTelegramOverview, type BotSummary, type ChatSummary, type NotifyCategory } from '@/lib/telegram-api';
import { colors, space, type } from '@/lib/theme';

const NOTIFY_SHORT: Record<NotifyCategory, string> = {
  requests: 'заявки',
  shifts: 'смены',
  clients: 'клиенты',
  money: 'деньги',
  stock: 'склад',
  events: 'мероприятия',
  streams: 'стримы',
};

/** Что бот делает в чате — одной строкой, чтобы не заходить внутрь ради проверки. */
function chatSubtitle(chat: ChatSummary): string {
  const parts = [
    chat.mode !== 'notify' && chat.taiOn ? 'Tai отвечает' : null,
    chat.commands ? `команд: ${chat.commands}` : null,
    chat.polls ? `опросов: ${chat.polls}` : null,
    chat.notify.length ? chat.notify.map((n) => NOTIFY_SHORT[n]).join(', ') : null,
    chat.welcome ? 'приветствие' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Бот в чате молчит';
}

/**
 * «Telegram» — бот клуба и все его группы в одном месте: связь с Telegram, добавление
 * в новый чат, у каждой группы своё назначение, Tai, команды, уведомления и приветствие.
 */
export default function TelegramScreen() {
  const router = useRouter();
  const club = useClubKey();
  const overview = useTelegramOverview();
  const [repairing, setRepairing] = useState(false);

  if (!overview.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {overview.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={overview.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const { bot, chats } = overview.data;
  const active = chats.filter((chat) => chat.active);
  const gone = chats.filter((chat) => !chat.active);
  const ready = bot.configured && bot.reachable;
  const openIntegration = () => router.push({ pathname: '/manage/settings/integration', params: { id: 'poll_bot' } });
  const openChat = (id: string) => router.push({ pathname: '/manage/telegram/chat', params: { id } });

  const repair = async () => {
    setRepairing(true);
    try {
      await repairWebhook();
      await invalidateTelegram(club);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Связь не настроилась', error instanceof Error ? error.message : String(error));
    } finally {
      setRepairing(false);
    }
  };

  return (
    <>
      <Stack.Title>Telegram</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await overview.refetch()))]}>
          <Section>
            <RNHostView matchContents>
              <BotHero bot={bot} />
            </RNHostView>
          </Section>

          {!bot.configured ? (
            <Section footer={<Text>Создайте бота в @BotFather и вставьте его токен — дальше всё настраивается здесь.</Text>}>
              <ActionRow title="Подключить бота" icon="paperplane.fill" onPress={openIntegration} />
            </Section>
          ) : !bot.reachable ? (
            <Section footer={<Text>Telegram не принимает токен. Возможно, его сменили в @BotFather.</Text>}>
              <ActionRow title="Обновить токен" icon="key.fill" onPress={openIntegration} />
            </Section>
          ) : !bot.webhook.ok ? (
            <Section footer={<Text>{bot.webhook.lastError ? `Telegram пишет: ${bot.webhook.lastError}` : 'Бот не получает сообщения из чатов.'}</Text>}>
              <ActionRow title={repairing ? 'Настраиваем…' : 'Починить связь с Telegram'} icon="arrow.triangle.2.circlepath" disabled={repairing} onPress={() => void repair()} />
            </Section>
          ) : null}

          {ready ? (
            <Section footer={<Text>Telegram предложит выбрать группу и выдать боту права администратора — с ними он видит всех участников и может закреплять сообщения.</Text>}>
              <ActionRow title="Добавить бота в чат" icon="plus.bubble.fill" onPress={() => router.push('/manage/telegram/add')} />
            </Section>
          ) : null}

          {MODES.map((mode) => {
            const list = active.filter((chat) => chat.mode === mode);
            if (!list.length) return null;
            return (
              <Section key={mode} title={MODE_INFO[mode].title}>
                {list.map((chat) => (
                  <LinkRow
                    key={chat.id}
                    icon={MODE_INFO[mode].icon}
                    color={MODE_INFO[mode].color}
                    title={chat.title || `Чат ${chat.id}`}
                    subtitle={chatSubtitle(chat)}
                    value={chat.botStatus === 'member' ? 'не админ' : undefined}
                    valueColor={colors.orange}
                    onPress={() => openChat(chat.id)}
                  />
                ))}
              </Section>
            );
          })}

          {ready && active.length === 0 ? (
            <Section>
              <ContentUnavailableView title="Бот ещё ни в одном чате" systemImage="bubble.left.and.bubble.right" description="Добавьте его в группу игроков, чат персонала или чат для уведомлений." />
            </Section>
          ) : null}

          {gone.length ? (
            <Section title="Бота удалили" footer={<Text>Сюда бот больше не пишет. Верните его кнопкой «Добавить бота в чат» или уберите чат из списка.</Text>}>
              {gone.map((chat) => (
                <LinkRow key={chat.id} icon="bubble.left.and.exclamationmark.bubble.right.fill" color="#8E8E93" title={chat.title || `Чат ${chat.id}`} onPress={() => openChat(chat.id)} />
              ))}
            </Section>
          ) : null}

          <Section title="Ещё">
            <LinkRow icon="checklist" color="#FF3B30" title="Опросы" subtitle="Сбор на игры по расписанию" onPress={() => router.push('/manage/polls')} />
            <LinkRow icon="dot.radiowaves.left.and.right" color="#FF2D55" title="Стримы" subtitle="Ссылки на эфир и донаты из MafBoard" onPress={() => router.push('/manage/telegram/streams')} />
            <LinkRow icon="sparkles" color="#8B5CF6" title="Tai" subtitle="Голос, клиенты в личке, что рассказывать о клубе" onPress={() => router.push('/manage/tai')} />
            {bot.configured ? <LinkRow icon="key.fill" color="#8E8E93" title="Токен бота" onPress={openIntegration} /> : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}

/** Шапка: аватар и имя бота, работает ли связь с Telegram. */
function BotHero({ bot }: { bot: BotSummary }) {
  const ready = bot.configured && bot.reachable;
  const title = ready ? bot.name || 'Бот клуба' : 'Бот клуба';
  const handle = ready && bot.username ? `@${bot.username}` : bot.configured ? 'Telegram не отвечает' : 'Не подключён';
  return (
    <View style={styles.hero}>
      {ready && bot.photo ? <Image source={{ uri: bot.photo }} style={styles.avatar} accessibilityIgnoresInvertColors /> : <TaiMark size={56} breathe />}
      <View style={styles.flex}>
        <RNText style={[type.title3, styles.label]}>{title}</RNText>
        <RNText style={[type.subhead, styles.secondary]}>{handle}</RNText>
        {ready ? (
          <View style={styles.statuses}>
            <Status ok={bot.webhook.ok} label={bot.webhook.ok ? 'На связи' : 'Нет связи'} />
            {/* Режим приватности: без прав админа бот не видит обычные сообщения и не знает участников. */}
            <Status ok={bot.readsAllMessages} label={bot.readsAllMessages ? 'Видит все сообщения' : 'Видит всё только как админ'} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: ok ? colors.green : colors.orange }]} />
      <RNText style={[type.caption1, styles.secondary]}>{label}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2, marginTop: space.xs },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
