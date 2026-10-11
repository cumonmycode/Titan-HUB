import { Button, ContentUnavailableView, Form, HStack, Host, LabeledContent, ProgressView, RNHostView, Section, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, monospacedDigit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { RankRow, Tile } from '@/components/analytics/native';
import { money } from '@/components/analytics/parts';
import { LinkRow, primary, secondary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { analyticsErrorText, usePlayerCard } from '@/lib/analytics-api';
import { balanceText, tierLook, useClientTiers } from '@/lib/clients-api';
import { plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { parseServerDate } from '@/lib/events-api';

const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
const checkDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const checksText = (n: number) => `${n} ${plural(n, ['чек', 'чека', 'чеков'])}`;

/** Игрок в цифрах: траты за всё время и за 30 дней, визиты, частота, последние чеки. */
export default function PlayerAnalyticsScreen() {
  // Фото в отчёте игрока сервер не отдаёт — приносим его из списка, откуда пришли.
  const { playerId, photo } = useLocalSearchParams<{ playerId: string; photo?: string }>();
  const router = useRouter();
  const card = usePlayerCard(playerId);
  const tiers = useClientTiers();
  const data = card.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {card.error ? <ContentUnavailableView title="Нет данных" systemImage="wifi.exclamationmark" description={analyticsErrorText(card.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const first = data.allTime.firstVisit ? parseServerDate(data.allTime.firstVisit) : null;
  const last = data.allTime.lastVisit ? parseServerDate(data.allTime.lastVisit) : null;
  const tier = tierLook(data.profile.clientTier, tiers.data);
  const balance = balanceText(data.profile.balance);
  const bonus = Math.floor(toNumber(data.profile.bonusPoints));

  return (
    <>
      <Stack.Title>{data.profile.nickname}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await card.refetch()))]}>
          <Section>
            <HStack spacing={14}>
              <RNHostView matchContents>
                <Avatar name={data.profile.nickname} photoUrl={photo} size={64} />
              </RNHostView>
              <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), primary, lineLimit(1)]}>{data.profile.nickname}</Text>
                {data.profile.fullName ? <Text modifiers={[secondary, lineLimit(1)]}>{data.profile.fullName}</Text> : null}
                <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>
                  {[tier.label, balance, bonus > 0 ? `${bonus} бонусов` : null].filter(Boolean).join(' · ')}
                </Text>
              </VStack>
            </HStack>
          </Section>

          <Section title="За всё время">
            <HStack spacing={12}>
              <Tile label="Потрачено" value={money(data.allTime.spend)} caption={data.allTime.refundsTotal > 0 ? `возвраты ${money(data.allTime.refundsTotal)}` : checksText(data.allTime.checksCount)} />
              <Tile label="Средний чек" value={money(Math.round(data.allTime.avgCheck))} />
            </HStack>
            <HStack spacing={12}>
              <Tile label="Дней с визитами" value={String(data.allTime.visitDays)} caption={`≈ ${String(data.allTime.visitsPerMonth).replace('.', ',')} в месяц`} />
              <Tile label="За 30 дней" value={money(data.last30.spend)} caption={checksText(data.last30.checksCount)} />
            </HStack>
          </Section>

          <Section>
            <LabeledContent label="Первый визит">
              <Text modifiers={[secondary]}>{first ? dateFormat.format(first) : '—'}</Text>
            </LabeledContent>
            <LabeledContent label="Последний визит">
              <Text modifiers={[secondary]}>
                {last ? `${dateFormat.format(last)}${data.allTime.daysSinceLast !== null ? ` · ${data.allTime.daysSinceLast} ${plural(data.allTime.daysSinceLast, ['день', 'дня', 'дней'])} назад` : ''}` : '—'}
              </Text>
            </LabeledContent>
            {data.profile.phone ? (
              <LabeledContent label="Телефон">
                <Text modifiers={[secondary, monospacedDigit()]}>{data.profile.phone}</Text>
              </LabeledContent>
            ) : null}
          </Section>

          {data.recentChecks.length > 0 && (
            <Section title="Последние чеки">
              {data.recentChecks.map((check) => (
                <Button
                  key={check.id}
                  onPress={() => {
                    haptic.selection();
                    router.push({ pathname: '/analytics/check/[checkId]', params: { checkId: check.id } });
                  }}>
                  <RankRow name={checkDate.format(new Date(check.createdAt))} value={money(toNumber(check.totalAmount))} />
                </Button>
              ))}
            </Section>
          )}

          <Section>
            <LinkRow icon="person.crop.circle" color="#007AFF" title="Карточка клиента" onPress={() => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: data.profile.id } })} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
