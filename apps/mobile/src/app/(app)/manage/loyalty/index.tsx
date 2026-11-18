import { Form, Host, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import type { SFSymbol } from 'sf-symbols-typescript';

import { LoyaltyPulse } from '@/components/loyalty-parts';
import { LinkRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';
import { formatMoney } from '@/lib/format';
import { LOYALTY_TEMPLATES, useBonusRules, useCertificates, useDiscounts, useLoyaltyOverview } from '@/lib/loyalty-api';
import { useSession } from '@/lib/session';

/**
 * Лояльность — один экран про всё, что клуб даёт гостям: пульс программы (бонусы на счетах,
 * выдано/потрачено, скидки), разделы (бонусы, скидки и акции, подарки, сертификаты, рост
 * статуса) и готовые акции, которые открывают редактор уже заполненным.
 */
export default function LoyaltyScreen() {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [days, setDays] = useState(30);
  const overview = useLoyaltyOverview(days);
  const discounts = useDiscounts();
  const rules = useBonusRules();
  const certificates = useCertificates();
  const settings = useSettingsEditor();

  const bonusOn = settings.flag('bonus_enabled', true);
  const activeDiscounts = (discounts.data ?? []).filter((d) => d.isActive);
  const activeRules = (rules.data ?? []).filter((r) => r.isActive).length;
  const activeCertificates = (certificates.data ?? []).filter((c) => c.status === 'active').length;
  const gifts = [
    settings.flag('welcome_bonus_enabled', false) ? 'новичкам' : null,
    settings.flag('referral_enabled', false) ? 'за друга' : null,
    settings.flag('birthday_bonus_enabled', false) ? 'ко дню рождения' : null,
  ].filter(Boolean);
  const threshold = settings.number('resident_visit_threshold', 10);
  const top = overview.data?.discounts.top[0];

  const refresh = async () => {
    await Promise.allSettled([overview.refetch(), discounts.refetch(), rules.refetch(), certificates.refetch(), settings.refetch()]);
  };
  const open = (href: Href) => router.push(href);

  return (
    <>
      <Stack.Title>Лояльность</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <Section>
            <RNHostView matchContents>
              <LoyaltyPulse data={overview.data} days={days} onDays={setDays} />
            </RNHostView>
          </Section>

          <Section title="Программа">
            {isOwner && (
              <LinkRow
                icon="star.circle.fill"
                color="#FF9500"
                title="Бонусы"
                subtitle={bonusOn ? `${settings.number('bonus_accrual_rate', 5)}% от покупки${activeRules ? ` · правил: ${activeRules}` : ''}` : 'Программа выключена'}
                value={bonusOn ? 'Вкл.' : 'Выкл.'}
                onPress={() => open('/manage/loyalty/bonus')}
              />
            )}
            <LinkRow
              icon="percent"
              color="#FF2D55"
              title="Скидки и акции"
              subtitle={top ? `Больше всех дала «${top.name}» — ${formatMoney(top.amount)}` : 'Сами по условиям или кассиром в чеке'}
              value={discounts.data ? `${activeDiscounts.length} вкл.` : undefined}
              onPress={() => open('/manage/loyalty/discounts')}
            />
            {isOwner && (
              <LinkRow
                icon="gift.fill"
                color="#34C759"
                title="Подарки"
                subtitle={gifts.length ? `Дарим ${gifts.join(', ')}` : 'Новичкам, за друга, ко дню рождения'}
                value={overview.data?.gifts ? `${overview.data.gifts} за ${days} дн.` : undefined}
                onPress={() => open('/manage/loyalty/gifts')}
              />
            )}
            <LinkRow
              icon="giftcard.fill"
              color="#AF52DE"
              title="Сертификаты"
              subtitle={overview.data?.certificates.active ? `Действует на ${formatMoney(overview.data.certificates.balance)}` : 'Свой номер или серия, на что действуют, срок'}
              value={certificates.data ? `${activeCertificates} действ.` : undefined}
              onPress={() => open('/manage/loyalty/certificates')}
            />
            {isOwner && (
              <LinkRow
                icon="arrow.up.forward.circle.fill"
                color="#007AFF"
                title="Рост статуса"
                subtitle={threshold > 0 ? `Резидент — после ${threshold} посещений` : 'Только вручную'}
                onPress={() => open('/manage/loyalty/status')}
              />
            )}
          </Section>

          <Section title="Готовые акции" footer={<Text>Откроется заполненный редактор — поправьте под себя и сохраните.</Text>}>
            {LOYALTY_TEMPLATES.filter((t) => isOwner || t.kind === 'discount').map((t) => (
              <LinkRow
                key={t.key}
                icon={t.icon as SFSymbol}
                color={t.color}
                title={t.title}
                subtitle={t.subtitle}
                onPress={() => open({ pathname: t.kind === 'discount' ? '/manage/loyalty/discount' : '/manage/loyalty/bonus-rule', params: { template: t.key } })}
              />
            ))}
          </Section>
        </Form>
      </Host>
    </>
  );
}
