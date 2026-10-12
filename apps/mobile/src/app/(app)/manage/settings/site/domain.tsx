import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { ActionRow, LinkRow, TextRow } from '@/components/native-form';
import { GlassCard } from '@/components/new-check-parts';
import { Text as RNText } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { saveSiteDomain, useSiteDomain, type SiteDomain } from '@/lib/site-api';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const GOOD = '#30D158';
const WAIT = '#FF9F0A';
const BAD = '#FF453A';

function certState(d: SiteDomain): { text: string; color: string; symbol: SFSymbol } {
  const c = d.cert;
  if (c?.cert === 'active') {
    const until = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return { text: `Сайт работает. Сертификат${until ? ` до ${until}` : ''}, продлевается сам`, color: GOOD, symbol: 'checkmark.seal.fill' };
  }
  if (c?.cert === 'error') return { text: c.error ?? 'Не удалось выпустить сертификат', color: BAD, symbol: 'exclamationmark.triangle.fill' };
  if (c?.cert === 'pending') return { text: c.error ?? 'Ждём DNS-записи', color: WAIT, symbol: 'clock.fill' };
  return { text: 'Сервер проверит домен в течение 5 минут после сохранения', color: WAIT, symbol: 'clock.fill' };
}

/**
 * Домен сайта: владелец вводит домен, ставит у регистратора две A-записи — HUB сам
 * проверяет их, выпускает и продлевает сертификат (агент на сервере раз в 5 минут).
 * Пока домена нет, сайт открывается по адресу зеркала.
 */
export default function SiteDomainScreen() {
  const domain = useSiteDomain();
  const [busy, setBusy] = useState(false);

  if (!domain.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {domain.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={domain.error.message} /> : <ProgressView />}
      </Host>
    );
  }
  const d = domain.data;

  const save = (next: string | null, primary: 'www' | 'apex') => {
    setBusy(true);
    saveSiteDomain(next, primary)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        Alert.alert('Домен не сохранён', errorText(error));
      })
      .finally(() => setBusy(false));
  };
  const unlink = () =>
    Alert.alert(`Отключить ${d.domain}?`, `Сайт перестанет открываться по этому адресу и останется на ${d.mirror.replace('https://', '')}.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: () => save(null, d.primary) },
    ]);
  const cert = certState(d);
  const ip = d.serverIp ?? 'IP сервера';

  return (
    <>
      <Stack.Title>Домен</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => { await domain.refetch(); })]}>
          <GlassCard style={styles.hero}>
            <View style={[styles.globe, { backgroundColor: d.domain ? cert.color : colors.fill }]}>
              <SymbolView name="globe" size={26} weight="semibold" tintColor="white" />
            </View>
            <RNText style={[type.title2, styles.label]} numberOfLines={1} adjustsFontSizeToFit>
              {d.domain ? (d.url ?? d.domain).replace('https://', '') : d.mirror.replace('https://', '')}
            </RNText>
            <View style={styles.state}>
              {d.domain && <SymbolView name={cert.symbol} size={13} weight="semibold" tintColor={cert.color} />}
              <RNText style={[type.footnote, styles.center, { color: d.domain ? cert.color : colors.secondaryLabel }]}>
                {d.domain ? cert.text : 'Свой домен не подключён — сайт открывается по адресу зеркала'}
              </RNText>
            </View>
          </GlassCard>

          <Section title="Адрес" footer={<Text>Например, titanmafia.ru — без https:// и www. Основной адрес — куда перенаправляется второй.</Text>}>
            <TextRow label="Домен" value={d.domain ?? ''} placeholder="club.ru" keyboard="url" capitalize="never" maxLength={253} onCommit={(next) => save(next || null, d.primary)} />
            <Picker
              selection={d.primary}
              onSelectionChange={(next) => {
                haptic.selection();
                save(d.domain, next as 'www' | 'apex');
              }}
              modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('www')]}>{d.domain ? `www.${d.domain}` : 'С www'}</Text>
              <Text modifiers={[tag('apex')]}>{d.domain ?? 'Без www'}</Text>
            </Picker>
          </Section>

          {d.domain && (
            <Section title="DNS у регистратора" footer={<Text>{`В панели регистратора домена поставьте две A-записи на ${ip}. Проверка — раз в минуту, сертификат выпустится сам.`}</Text>}>
              <LinkRow
                icon={d.dns.apex.ok ? 'checkmark' : 'clock'}
                color={d.dns.apex.ok ? GOOD : WAIT}
                title={`A · @ → ${ip}`}
                subtitle={d.dns.apex.ok ? 'Готово' : d.dns.apex.ips.length ? `Сейчас: ${d.dns.apex.ips.join(', ')}` : 'Записи нет'}
                chevron={false}
              />
              <LinkRow
                icon={d.dns.www.ok ? 'checkmark' : 'clock'}
                color={d.dns.www.ok ? GOOD : WAIT}
                title={`A · www → ${ip}`}
                subtitle={d.dns.www.ok ? 'Готово' : d.dns.www.ips.length ? `Сейчас: ${d.dns.www.ips.join(', ')}` : 'Записи нет'}
                chevron={false}
              />
            </Section>
          )}

          <Section>
            <ActionRow
              title="Открыть сайт"
              icon="safari"
              disabled={busy}
              onPress={() => void WebBrowser.openBrowserAsync(d.url && d.cert?.cert === 'active' ? d.url : d.mirror)}
            />
            {d.domain ? <ActionRow title="Отключить домен" icon="xmark.circle" destructive disabled={busy} onPress={unlink} /> : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, padding: space.xl, marginBottom: space.sm },
  globe: { width: 56, height: 56, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.label },
  state: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm },
  center: { textAlign: 'center', flexShrink: 1 },
});
