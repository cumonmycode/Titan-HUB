import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { endActiveStream, publishActiveStream, setStreamsAutoPublish, useStreams, type Stream, type StreamsState } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const SOURCE: Record<Stream['source'], string> = { mafboard: 'MafBoard', studio: 'MafBoard Studio', hub: 'Titan HUB' };
const timeText = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/**
 * Стримы: MafBoard и MafBoard Studio молча передают сюда ссылки на эфир и донаты.
 * Здесь решается, отдавать ли их Tai — он выложит пост в чаты, где включены уведомления
 * «Стримы» (в их тему), и ответит ссылкой на /stream.
 */
export default function StreamsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const query = useStreams();
  const [busy, setBusy] = useState(false);
  const data = query.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'streams'] });

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {query.isError ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(query.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await action();
      haptic.success();
      await refresh();
      Alert.alert(done);
    } catch (error) {
      haptic.error();
      Alert.alert('Не получилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = (on: boolean) => {
    haptic.selection();
    queryClient.setQueryData([club, 'telegram', 'streams'], { ...data, autoPublish: on });
    setStreamsAutoPublish(on).catch((error: unknown) => {
      void refresh();
      Alert.alert('Не сохранилось', errorText(error));
    });
  };

  const active = data.active;
  const targetsText = data.targets
    ? `Публикуется в ${data.targets} чат(а) — там, где в «Уведомлениях» включены «Стримы».`
    : 'Ни в одном чате не включены уведомления «Стримы»: откройте чат → Уведомления → Стримы и выберите тему.';

  return (
    <>
      <Stack.Title>Стримы</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section footer={<Text>{`Когда MafBoard начинает эфир, ссылки приходят в HUB. Включено — Tai сразу публикует их и отвечает на /stream; выключено — эфир виден только здесь. ${targetsText}`}</Text>}>
            <Toggle label="Публиковать стримы через Tai" isOn={data.autoPublish} onIsOnChange={toggleAuto} />
          </Section>

          {sourceWarning(data) ? (
            <Section title="Эфир не дойдёт" footer={<Text>{sourceWarning(data)!.text}</Text>}>
              {sourceWarning(data)!.connection ? (
                <LinkRow
                  icon="exclamationmark.triangle.fill"
                  color="#FF9500"
                  title={`Включить «Стримы» у «${sourceWarning(data)!.connection!.name}»`}
                  onPress={() => router.push({ pathname: '/manage/settings/connect/connection', params: { id: sourceWarning(data)!.connection!.id } })}
                />
              ) : (
                <LinkRow icon="exclamationmark.triangle.fill" color="#FF9500" title="Подключить MafBoard" onPress={() => router.push('/manage/settings/connect')} />
              )}
            </Section>
          ) : null}

          <Section title="Сейчас" footer={active ? <Text>{`${SOURCE[active.source]} · с ${timeText(active.startedAt)} · ${active.published ? `опубликован в ${active.posts.length} чат(а)` : 'не опубликован'}`}</Text> : undefined}>
            {active ? (
              <>
                <LinkRow icon="dot.radiowaves.left.and.right" color="#FF3B30" title={active.title} subtitle={active.published ? 'Tai показывает по /stream' : 'Tai о нём не знает'} chevron={false} />
                {active.links.map((link) => (
                  <LinkRow
                    key={link.url}
                    icon={link.kind === 'donate' ? 'heart.fill' : 'play.rectangle.fill'}
                    color={link.kind === 'donate' ? '#FF9500' : '#0A84FF'}
                    title={link.label}
                    subtitle={link.url}
                    onPress={() => void Linking.openURL(link.url)}
                  />
                ))}
                {!active.published ? <ActionRow title="Опубликовать через Tai" icon="paperplane.fill" disabled={busy} onPress={() => void run(publishActiveStream, 'Опубликовано')} /> : null}
                <ActionRow title="Завершить эфир" icon="stop.circle" destructive disabled={busy} onPress={() => void run(endActiveStream, 'Эфир завершён')} />
              </>
            ) : (
              <LinkRow icon="moon.zzz.fill" color="#8E8E93" title="Эфира нет" subtitle={data.last ? `Последний: ${data.last.title}, ${timeText(data.last.startedAt)}` : 'MafBoard ещё ничего не присылал'} chevron={false} />
            )}
          </Section>

          <Section footer={<Text>Если эфир идёт не из MafBoard — вставьте ссылки сами, Tai опубликует их сразу.</Text>}>
            <ActionRow title="Объявить стрим вручную" icon="plus.circle.fill" onPress={() => router.push('/manage/telegram/stream-new')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}

/**
 * Почему эфир может не приходить: MafBoard шлёт его через подключение Titan Connect, и без
 * права «Стримы» HUB отвечает отказом — Tai публиковать нечего.
 */
function sourceWarning(data: StreamsState): { text: string; connection: { id: string; name: string } | null } | null {
  const sources = data.sources;
  if (!sources) return null;
  if (sources.some((s) => s.canStream)) return null;
  const first = sources[0] ?? null;
  return first
    ? { text: `У подключения «${first.name}» выключено право «Стримы» — MafBoard присылает эфир, а HUB его не принимает. Включите право, и следующий эфир Tai опубликует сам.`, connection: first }
    : { text: 'MafBoard не подключён к HUB — эфиры сюда не приходят. Подключите его в «Настройки → Подключения».', connection: null };
}
