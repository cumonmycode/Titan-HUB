import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { Stack, useRouter } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { LinkRow } from '@/components/native-form';
import { GlassCard } from '@/components/new-check-parts';
import { SiteMock } from '@/components/site/site-mock';
import { Text as RNText } from '@/components/text';
import { useBookingRequests } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { DEFAULT_SCHEDULE, siteUrlOf, useSiteConfig, useSiteDomain, useSiteStories, type SiteConfig, type SiteDomain } from '@/lib/site-api';
import { lookOf } from '@/lib/site-looks';
import { colors, space, type } from '@/lib/theme';

/**
 * «Сайт» клуба в HUB: превью первого экрана в текущем оформлении, адрес и его
 * состояние, затем всё управление сайтом — оформление, расписание, публикации,
 * онлайн-запись (заявки и уведомления), домен и контакты. Всё нативно, без веб-HUB.
 */
export default function SiteScreen() {
  const router = useRouter();
  const config = useSiteConfig();
  const domain = useSiteDomain();
  const stories = useSiteStories();
  const requests = useBookingRequests();

  const refresh = async () => {
    await Promise.allSettled([config.refetch(), domain.refetch(), stories.refetch(), requests.refetch()]);
  };

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const look = lookOf(config.data.holiday);
  const evenings = (config.data.schedule ?? DEFAULT_SCHEDULE).length;
  const published = (stories.data ?? []).filter((s) => s.is_published).length;
  const fresh = (requests.data ?? []).length;
  const go = (path: string) => router.push(path as never);

  return (
    <>
      <Stack.Title>Сайт</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <SiteHero config={config.data} domain={domain.data} onLook={() => go('/manage/settings/site/look')} />

          <Section title="Сайт">
            <LinkRow icon="paintpalette.fill" color="#AF52DE" title="Оформление" subtitle={look.hint} value={look.title} onPress={() => go('/manage/settings/site/look')} />
            <LinkRow icon="calendar" color="#FF9500" title="Расписание вечеров" subtitle="По нему сайт показывает ближайшие игры" value={`${evenings} в неделю`} onPress={() => go('/manage/settings/site/schedule')} />
            <LinkRow icon="photo.on.rectangle.angled" color="#34C759" title="Публикации" subtitle="Турниры и вечеринки с фото" value={stories.data ? String(published) : undefined} onPress={() => go('/manage/settings/site/stories')} />
          </Section>

          <Section title="Онлайн-запись" footer={<Text>Запись на игру, бронь зоны, выезд, сертификаты и вопросы с сайта. Бывшая ссылка /book ведёт туда же.</Text>}>
            <LinkRow icon="tray.full.fill" color="#007AFF" title="Заявки" value={requests.data ? (fresh ? `${fresh} новых` : 'Нет новых') : undefined} onPress={() => router.navigate('/events')} />
            <LinkRow
              icon="bell.badge.fill"
              color="#FF3B30"
              title="Уведомления"
              subtitle={notifySubtitle(config.data)}
              onPress={() => go('/manage/settings/site/notify')}
            />
          </Section>

          <Section title="Адрес и контакты">
            <LinkRow
              icon="globe"
              color="#5856D6"
              title="Домен"
              value={domain.data?.domain ?? 'Не подключён'}
              valueColor={domainState(domain.data).color}
              onPress={() => go('/manage/settings/site/domain')}
            />
            <LinkRow icon="phone.fill" color="#34C759" title="Контакты" subtitle="Телефон, почта и соцсети на сайте" value={config.data.contacts?.phone || undefined} onPress={() => go('/manage/settings/site/contacts')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}

function notifySubtitle(c: SiteConfig): string {
  const chat = c.notifyChat ? c.chats?.find((x) => x.id === c.notifyChat?.chatId) : null;
  const staff = c.notifyChat ? `чат «${chat?.title ?? 'персонала'}»` : 'push владельцам и смене';
  return c.guestBot ? `${staff} · гостям — через @${c.guestBot}` : staff;
}

function domainState(d: SiteDomain | undefined): { text: string; color: string; symbol: SFSymbol } {
  if (!d?.domain) return { text: 'Открывается по адресу зеркала', color: '#FF9F0A', symbol: 'globe' };
  if (d.cert?.cert === 'active') return { text: 'Работает, сертификат в порядке', color: '#30D158', symbol: 'checkmark.seal.fill' };
  if (d.cert?.cert === 'error') return { text: d.cert.error ?? 'Ошибка подключения', color: '#FF453A', symbol: 'exclamationmark.triangle.fill' };
  return { text: 'Подключается — ждём DNS и сертификат', color: '#FF9F0A', symbol: 'clock.fill' };
}

function SiteHero({ config, domain, onLook }: { config: SiteConfig; domain: SiteDomain | undefined; onLook: () => void }) {
  const look = lookOf(config.holiday);
  const url = siteUrlOf(domain);
  const state = domainState(domain);
  const open = () => {
    haptic.light();
    void WebBrowser.openBrowserAsync(url);
  };
  const share = () => {
    haptic.light();
    void Share.share({ message: url, url });
  };
  return (
    <GlassCard style={styles.hero}>
      <Pressable onPress={onLook} accessibilityRole="button" accessibilityLabel={`Оформление: ${look.title}`} style={({ pressed }) => pressed && styles.pressed}>
        <SiteMock look={look} width={118} />
      </Pressable>
      <View style={styles.heroInfo}>
        <RNText style={[type.title3, styles.label]} numberOfLines={2}>
          {url.replace('https://', '')}
        </RNText>
        <View style={styles.state}>
          <SymbolView name={state.symbol} size={13} weight="semibold" tintColor={state.color} />
          <RNText style={[type.footnote, styles.flex, { color: state.color }]} numberOfLines={2}>
            {state.text}
          </RNText>
        </View>
        <RNText style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {look.id === 'none' ? 'Обычный вид' : `Оформление: ${look.title}`}
        </RNText>
        <View style={styles.actions}>
          <HeroButton symbol="safari" title="Открыть" onPress={open} primary />
          <HeroButton symbol="square.and.arrow.up" title="Поделиться" onPress={share} />
        </View>
      </View>
    </GlassCard>
  );
}

function HeroButton({ symbol, title, onPress, primary }: { symbol: SFSymbol; title: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.button, primary ? styles.buttonPrimary : styles.buttonGhost, pressed && styles.pressed]}>
      <SymbolView name={symbol} size={14} weight="semibold" tintColor={primary ? 'white' : colors.label} />
      <RNText style={[type.subhead, styles.buttonText, primary ? styles.onAccent : styles.label]}>{title}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { flexDirection: 'row', gap: space.lg, padding: space.lg, marginBottom: space.sm },
  heroInfo: { flex: 1, gap: space.sm, justifyContent: 'center' },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  actions: { gap: space.sm, marginTop: space.xs },
  button: { minHeight: 40, borderRadius: 12, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.md },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonGhost: { backgroundColor: colors.fill },
  buttonText: { fontWeight: '600' },
  onAccent: { color: 'white' },
  pressed: { opacity: 0.7 },
});
