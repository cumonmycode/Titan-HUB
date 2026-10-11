import { Button, ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { RankRow } from '@/components/analytics/native';
import { money } from '@/components/analytics/parts';
import { analyticsErrorText, useSegmentMembers, type SegmentKey } from '@/lib/analytics-api';
import { tierLook, useClientTiers } from '@/lib/clients-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseServerDate } from '@/lib/events-api';

const TITLES: Record<SegmentKey, { title: string; caption: string }> = {
  new: { title: 'Новые', caption: 'Зарегистрированы, но ещё не приходили.' },
  active: { title: 'Активные', caption: 'Приходили за последние 14 дней.' },
  sleeping: { title: 'Спящие', caption: 'Не приходили 14 дней и дольше — их стоит пригласить.' },
};

const lastVisitFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });

/** Игроки сегмента; тап открывает карточку игрока. */
export default function SegmentScreen() {
  const { segment } = useLocalSearchParams<{ segment: SegmentKey }>();
  const router = useRouter();
  const key: SegmentKey = segment === 'active' || segment === 'sleeping' ? segment : 'new';
  const members = useSegmentMembers(key);
  const tiers = useClientTiers();
  // Сервер группирует и обезличенные чеки — строку без игрока не показываем.
  const list = (members.data?.players ?? []).filter((p) => p.playerId);

  return (
    <>
      <Stack.Title>{TITLES[key].title}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {!members.data ? (
          members.error ? (
            <ContentUnavailableView title="Нет данных" systemImage="wifi.exclamationmark" description={analyticsErrorText(members.error)} />
          ) : (
            <ProgressView />
          )
        ) : list.length === 0 ? (
          <ContentUnavailableView title="В сегменте пока никого" systemImage="person.2" description={TITLES[key].caption} />
        ) : (
          <Form modifiers={[refreshable(async () => void (await members.refetch()))]}>
            <Section title={`${list.length} ${plural(list.length, ['игрок', 'игрока', 'игроков'])}`} footer={<Text>{TITLES[key].caption}</Text>}>
              {list.map((item) => {
                const look = tierLook(item.clientTier ?? 'guest', tiers.data);
                const last = item.lastVisit ? parseServerDate(item.lastVisit) : null;
                return (
                  <Button
                    key={item.playerId}
                    onPress={() => {
                      haptic.selection();
                      router.push({ pathname: '/analytics/player/[playerId]', params: { playerId: item.playerId, ...(item.photoUrl ? { photo: item.photoUrl } : {}) } });
                    }}>
                    <RankRow
                      name={item.nickname ?? 'Игрок'}
                      caption={
                        key === 'new'
                          ? `${look.label} · ещё не приходил`
                          : `${look.label} · ${item.visits} ${plural(item.visits, ['чек', 'чека', 'чеков'])}${last ? ` · был ${lastVisitFormat.format(last).replace('.', '')}` : ''}`
                      }
                      value={key === 'new' ? '' : money(item.total)}
                    />
                  </Button>
                );
              })}
            </Section>
          </Form>
        )}
      </Host>
    </>
  );
}
