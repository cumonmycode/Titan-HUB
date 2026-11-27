import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { LinkRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { DEFAULT_STREAM_PUSH, setStreamsAppPush, useStreams } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * «Маркетинг → Трансляции»: как клиенты My Titan узнают об эфирах клуба — push о начале
 * эфира (вкл/выкл и текст) и площадки с донатом, которые видны в приложении всегда.
 * Сами эфиры и их публикация в чатах — в «Telegram → Стримы».
 */
export default function MarketingStreamsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const query = useStreams();
  const data = query.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {query.isError ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(query.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const pushOn = data.appPush !== false;
  const togglePush = (on: boolean) => {
    haptic.selection();
    queryClient.setQueryData([club, 'telegram', 'streams'], { ...data, appPush: on });
    setStreamsAppPush(on).catch((error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'streams'] });
      Alert.alert('Не сохранилось', errorText(error));
    });
  };

  const channels = data.channels ?? [];
  const watchCount = channels.filter((l) => l.kind === 'watch').length;
  const hasDonate = channels.some((l) => l.kind === 'donate');
  const channelsText = channels.length
    ? [watchCount ? `${watchCount} ${watchCount === 1 ? 'площадка' : 'площадки'}` : null, hasDonate ? 'донат' : null].filter(Boolean).join(' · ')
    : 'Не указаны';
  const pushTitle = data.appPushTitle || DEFAULT_STREAM_PUSH.title;
  const pushBody = (data.appPushBody || DEFAULT_STREAM_PUSH.body).replace(/\{название\}/gi, data.active?.title ?? 'Финал турнира');

  return (
    <>
      <Stack.Title>Трансляции</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section
            title="Push клиентам My Titan"
            footer={<Text>Приходит, когда эфир опубликован, — один раз за эфир. Клиент может отключить такие уведомления у себя в профиле.</Text>}
          >
            <Toggle label="Сообщать о начале эфира" isOn={pushOn} onIsOnChange={togglePush} />
            <LinkRow
              icon="text.bubble.fill"
              color="#FF2D55"
              title={pushTitle}
              subtitle={pushBody}
              onPress={() => router.push('/manage/streams/push-text')}
            />
          </Section>

          <Section title="Где смотреть" footer={<Text>Каналы клуба и ссылка на донат — клиенты видят их в «Трансляциях» My Titan всегда, и между эфирами.</Text>}>
            <LinkRow icon="play.tv.fill" color="#AF52DE" title="Площадки и донат" subtitle={channelsText} onPress={() => router.push('/manage/streams/channels')} />
          </Section>

          <Section footer={<Text>Эфиры из MafBoard, публикация через Tai в чатах и стрим вручную.</Text>}>
            <LinkRow icon="paperplane.fill" color="#2AABEE" title="Эфиры и публикация" subtitle={data.active ? `Сейчас: ${data.active.title}` : 'Telegram → Стримы'} onPress={() => router.push('/manage/telegram/streams')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
