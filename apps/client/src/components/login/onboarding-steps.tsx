// Экраны до входа в духе Telegram: знакомство (листаемые страницы с «Начать») и
// разрешения — объясняем, зачем они, и только потом показываем системный запрос.
//
// App Review 5.1.1(iv), 2026-10-12: экран перед системным запросом не должен уговаривать
// («Разрешить доступ…») и не должен давать уйти мимо запроса («Не сейчас», «Назад»).
// Поэтому одна нейтральная кнопка «Продолжить», которая всегда открывает системный запрос;
// решение клиент принимает уже там.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ClubCard } from '@/components/club-card';
import { GlassButton } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { Surface } from '@/components/ui';
import { colors, GUTTER, MAX_WIDTH, radius, space, type } from '@/lib/theme';

import { OnboardingLayout } from './onboarding-layout';

const SAMPLE_CARD = {
  nickname: 'titan', tierLabel: 'Резидент', tierColor: colors.violet, bonus: 1240, bonusHidden: false, deposit: 3500, visits: 27,
};

const PAGES: { key: string; icon?: IconName; color?: string; title: string; text: string }[] = [
  { key: 'card', title: 'My Titan', text: 'Карта клуба Titan — всегда в вашем телефоне.' },
  { key: 'bonus', icon: 'bonus', color: colors.gold, title: 'Бонусы и депозит', text: 'Начисления, сгорание и баланс видно сразу после каждой игры.' },
  { key: 'pay', icon: 'bolt', color: colors.cyan, title: 'Оплата за секунды', text: 'Пополняйте депозит, гасите долг и вносите взносы через СБП.' },
];

// ── Знакомство ─────────────────────────────────────────────────────────────────
export function IntroStep({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const cardWidth = Math.min(width - GUTTER * 2, MAX_WIDTH) - space.xl;

  return (
    <OnboardingLayout
      footer={
        <>
          <GlassButton title="Начать" onPress={onStart} />
          <GlassButton title="Посмотреть демо" variant="ghost" size="md" onPress={onDemo} />
        </>
      }
    >
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.pager}
      >
        {PAGES.map((p, i) => (
          <View key={p.key} style={[styles.page, { width }]}>
            <View style={styles.hero}>
              {p.icon && p.color ? (
                <Surface tone={p.color} style={styles.bigIcon}>
                  <Icon name={p.icon} size={56} color={p.color} />
                </Surface>
              ) : (
                <View style={{ width: cardWidth }}>
                  <ClubCard data={SAMPLE_CARD} interactive={false} motion={i === page} />
                </View>
              )}
            </View>
            <Text style={styles.pageTitle}>{p.title}</Text>
            <Text style={styles.pageText}>{p.text}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots} accessibilityLabel={`Страница ${page + 1} из ${PAGES.length}`}>
        {PAGES.map((p, i) => <View key={p.key} style={[styles.dot, i === page && styles.dotOn]} />)}
      </View>
    </OnboardingLayout>
  );
}

// ── Разрешение ─────────────────────────────────────────────────────────────────
export interface PermissionInfo {
  icon: IconName;
  color: string;
  title: string;
  text: string;
  points: { icon: IconName; text: string }[];
}

export const NOTIFICATIONS_PERMISSION: PermissionInfo = {
  icon: 'inbox',
  color: colors.violetLight,
  title: 'Уведомления',
  text: 'My Titan присылает уведомления о вашей карте клуба. Дальше телефон спросит, разрешить ли их.',
  points: [
    { icon: 'bonus', text: 'Начисление и сгорание бонусов' },
    { icon: 'deposit', text: 'Пополнения депозита и долг' },
    { icon: 'paid', text: 'Подтверждение регистрации и оплат' },
    { icon: 'news', text: 'Новости и события клуба' },
  ],
};

export const CAMERA_PERMISSION: PermissionInfo = {
  icon: 'camera',
  color: colors.cyan,
  title: 'Камера',
  text: 'Камера нужна, чтобы сфотографироваться для профиля прямо в приложении. Дальше телефон спросит, разрешить ли доступ.',
  points: [
    { icon: 'person', text: 'Фото в профиле — по нему вас узнают в клубе' },
    { icon: 'shield', text: 'Камера включается, только когда вы сами её открываете' },
  ],
};

export function PermissionStep({ info, busy, onContinue }: {
  info: PermissionInfo;
  busy?: boolean;
  /** Всегда показывает системный запрос, затем ведёт дальше — что бы клиент ни выбрал. */
  onContinue: () => void;
}) {
  return (
    <OnboardingLayout
      centered
      hero={
        <Animated.View entering={FadeIn.duration(300)} style={styles.hero}>
          <Surface tone={info.color} style={styles.bigIcon}>
            <Icon name={info.icon} size={56} color={info.color} />
          </Surface>
        </Animated.View>
      }
      title={info.title}
      subtitle={info.text}
      footer={<GlassButton title="Продолжить" loading={busy} onPress={onContinue} />}
    >
      <Surface style={styles.points}>
        {info.points.map((p) => (
          <View key={p.text} style={styles.point}>
            <Icon name={p.icon} size={18} color={info.color} />
            <Text style={styles.pointText}>{p.text}</Text>
          </View>
        ))}
      </Surface>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  pager: { flexGrow: 0, marginHorizontal: -GUTTER },
  page: { paddingHorizontal: GUTTER, alignItems: 'center' },
  hero: { alignItems: 'center', justifyContent: 'center', minHeight: 220 },
  bigIcon: { width: 120, height: 120, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { ...StyleSheet.flatten(type.title), textAlign: 'center', marginTop: space.xl },
  pageText: { ...StyleSheet.flatten(type.body), color: colors.textSecondary, textAlign: 'center', marginTop: space.sm, maxWidth: 320 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.xl },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotOn: { width: 20, backgroundColor: colors.violetLight },
  points: { marginTop: space.xl, borderRadius: radius.card, padding: space.lg, gap: space.md },
  point: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pointText: { ...StyleSheet.flatten(type.callout), flex: 1 },
});
