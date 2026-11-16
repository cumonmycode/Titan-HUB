import { Button, HStack, Image, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { background, font, foregroundStyle, frame, lineLimit, shapes } from '@expo/ui/swift-ui/modifiers';

import { primary, secondary, tertiary } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { msk, todayMsk, useSmmOverview } from '@/lib/smm-api';
import { useAccentHex } from '@/lib/theme';

/** Системный оранжевый iOS — «требует внимания». */
const ATTENTION_HEX = '#FF9500';

/**
 * Карточка «СММ и маркетинг» вверху «Меню»: что выходит сегодня, что ждёт одобрения
 * и в каком состоянии план — чтобы не заходить внутрь ради проверки.
 */
export function SmmCard({ onPress }: { onPress: () => void }) {
  const accent = useAccentHex();
  const overview = useSmmOverview();
  const data = overview.data;
  const today = todayMsk();
  const todayCount = data?.upcoming.filter((p) => msk(p.publishAt)?.date === today && p.status !== 'skipped').length ?? 0;
  const review = data?.counts.review ?? 0;
  const link = data?.counts.awaitingLink ?? 0;
  const plan = !data ? '' : !data.plan?.summary ? 'Плана нет' : data.plan.status === 'active' ? 'План утверждён' : 'План ждёт утверждения';
  const line1 = data ? `Сегодня: ${todayCount ? `${todayCount} публ.` : 'публикаций нет'}` : 'Tai ведёт Telegram и Instagram';
  const failed = data?.counts.failed ?? 0;
  // Одна строка — самое срочное. Раньше все статусы шли через «·» и переносились на две
  // строки оранжевым («на одобрении 1 · ждём ссылку 2 · план / утверждён»).
  const line2 = !data
    ? 'План, посты, картинки, аналитика'
    : failed
      ? `Не вышло: ${failed}`
      : review
        ? `Ждёт одобрения: ${review}${link ? ` · ссылок: ${link}` : ''}`
        : link
          ? `Ждём ссылку: ${link}`
          : plan;
  const attention = review > 0 || link > 0 || failed > 0;

  return (
    <Section>
      <Button
        onPress={() => {
          haptic.selection();
          onPress();
        }}>
        <HStack spacing={14}>
          {/* Размер — как у аватара в карточке профиля над ней: две верхние карточки в одну линию. */}
          <Image systemName="sparkles" size={24} color="white" modifiers={[frame({ width: 58, height: 58 }), background(accent, shapes.roundedRectangle({ cornerRadius: 16 }))]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ textStyle: 'title3', weight: 'semibold' }), primary, lineLimit(1)]}>СММ и маркетинг</Text>
            <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{line1}</Text>
            <Text modifiers={[font({ textStyle: 'footnote' }), attention ? foregroundStyle(ATTENTION_HEX) : secondary, lineLimit(1)]}>{line2}</Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />
        </HStack>
      </Button>
    </Section>
  );
}
