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
  const plan = !data ? '' : !data.plan?.summary ? 'плана нет' : data.plan.status === 'active' ? 'план утверждён' : 'план ждёт утверждения';
  const line1 = data ? `Сегодня: ${todayCount ? `${todayCount} публ.` : 'публикаций нет'}` : 'Tai ведёт Telegram и Instagram';
  const line2 = data ? [review ? `на одобрении ${review}` : null, link ? `ждём ссылку ${link}` : null, plan].filter(Boolean).join(' · ') : 'План, посты, картинки, аналитика';
  const attention = review > 0 || link > 0 || (data?.counts.failed ?? 0) > 0;

  return (
    <Section>
      <Button
        onPress={() => {
          haptic.selection();
          onPress();
        }}>
        <HStack spacing={14}>
          <Image systemName="sparkles" size={24} color="white" modifiers={[frame({ width: 52, height: 52 }), background(accent, shapes.roundedRectangle({ cornerRadius: 14 }))]} />
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ textStyle: 'title3', weight: 'semibold' }), primary, lineLimit(1)]}>СММ и маркетинг</Text>
            <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{line1}</Text>
            <Text modifiers={[font({ textStyle: 'footnote' }), attention ? foregroundStyle(ATTENTION_HEX) : secondary, lineLimit(2)]}>{line2}</Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />
        </HStack>
      </Button>
    </Section>
  );
}
