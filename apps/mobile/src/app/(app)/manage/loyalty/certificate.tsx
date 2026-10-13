import { ContentUnavailableView, DatePicker, Form, Host, LabeledContent, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { monospacedDigit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Share, StyleSheet, View } from 'react-native';

import { ActionRow, LinkRow, secondary, TextRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { chooseAction } from '@/lib/dialog';
import { fromDateTime, toDateString } from '@/lib/events-api';
import { formatMoney } from '@/lib/format';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { CERT_SCOPE_LABEL, CERT_STATUS_LOOK, deactivateCertificate, updateCertificate, useCertificate, type Certificate } from '@/lib/loyalty-api';
import { useSession } from '@/lib/session';
import { space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const dateText = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const usedAt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const DEFAULT_VALID_DAYS = 90;

/** Сертификат: номер и остаток, на что действует, срок, получатель и где им уже платили. */
export default function CertificateScreen() {
  const { certificateId } = useLocalSearchParams<{ certificateId: string }>();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const query = useCertificate(certificateId);
  const goods = useGoods();
  const cert = query.data?.certificate;

  if (!cert) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {query.isLoading ? <ProgressView /> : <ContentUnavailableView title="Сертификат не найден" systemImage="giftcard" />}
      </Host>
    );
  }

  const look = CERT_STATUS_LOOK[cert.status];
  const update = (patch: Parameters<typeof updateCertificate>[1]) =>
    updateCertificate(cert.id, patch)
      .then(() => haptic.success())
      .catch((error: unknown) => Alert.alert('Не сохранилось', errorText(error)));

  const scopeNames =
    cert.scope === 'categories'
      ? cert.categoryIds.map((id) => goods.data?.categories.find((c) => c.id === id)?.name).filter(Boolean).join(', ')
      : cert.scope === 'items'
        ? cert.itemIds.map((id) => goods.data?.byId.get(id)?.name).filter(Boolean).join(', ')
        : null;

  const share = () =>
    void Share.share({
      message: [`Подарочный сертификат № ${cert.code}`, cert.title, `на ${formatMoney(cert.balance)}`, cert.validUntil ? `действует до ${dateText(cert.validUntil)}` : null].filter(Boolean).join('\n'),
    });

  const voidIt = () =>
    chooseAction(`Погасить ${cert.code}?`, 'Сертификат перестанет приниматься в кассе, остаток сгорит.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Погасить',
        style: 'destructive',
        onPress: () =>
          void deactivateCertificate(cert.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Не погашен', errorText(error))),
      },
    ]);

  return (
    <>
      <Stack.Title>{cert.code}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section>
            <RNHostView matchContents>
              <CertificateFace cert={cert} statusLabel={look.label} statusColor={look.color} />
            </RNHostView>
          </Section>

          <Section title="На что действует">
            <LinkRow icon="scope" color="#5856D6" title={CERT_SCOPE_LABEL[cert.scope]} subtitle={scopeNames || undefined} chevron={false} />
          </Section>

          <Section title="Срок и получатель" footer={<Text>{cert.series ? `Серия ${cert.series}.` : 'Выпущен отдельно.'}</Text>}>
            <Toggle label="Срок действия" isOn={!!cert.validUntil} onIsOnChange={(on) => void update({ validUntil: on ? toDateString(new Date(Date.now() + DEFAULT_VALID_DAYS * 86_400_000)) : null })} />
            {cert.validUntil ? <DatePicker title="Действует до" selection={fromDateTime(cert.validUntil, '12:00')} displayedComponents={['date']} onDateChange={(date) => void update({ validUntil: toDateString(date) })} /> : null}
            <TextRow label="Получатель" value={cert.recipient ?? ''} placeholder="Кому подарили" onCommit={(recipient) => void update({ recipient: recipient || null })} />
            <TextRow label="Заметка" value={cert.note ?? ''} placeholder="Например, купили за наличные" onCommit={(note) => void update({ note: note || null })} />
          </Section>

          <Section title="Где применён">
            {query.data?.uses.length ? (
              query.data.uses.map((u) => (
                <LabeledContent key={u.checkId} label={[u.player ?? 'Гость', u.closedAt ? usedAt.format(new Date(u.closedAt)) : null].filter(Boolean).join(' · ')}>
                  <Text modifiers={[monospacedDigit()]}>{`−${formatMoney(u.amount)}`}</Text>
                </LabeledContent>
              ))
            ) : (
              <Text modifiers={[secondary]}>Ещё не применялся</Text>
            )}
          </Section>

          <Section>
            <ActionRow title="Поделиться" icon="square.and.arrow.up" onPress={share} />
            {isOwner && cert.status === 'active' ? <ActionRow title="Погасить" icon="xmark.seal" destructive onPress={voidIt} /> : null}
          </Section>
        </Form>
      </Host>
    </>
  );
}

/** «Лицо» сертификата: номер крупно, название, остаток и статус. */
function CertificateFace({ cert, statusLabel, statusColor }: { cert: Certificate; statusLabel: string; statusColor: string }) {
  return (
    <View style={styles.face}>
      <View style={styles.row}>
        <RNText style={[type.footnote, styles.muted]}>ПОДАРОЧНЫЙ СЕРТИФИКАТ</RNText>
        <View style={[styles.chip, { backgroundColor: `${statusColor}33` }]}>
          <RNText style={[type.caption1, styles.chipText, { color: statusColor }]}>{statusLabel}</RNText>
        </View>
      </View>
      <RNText style={styles.code} selectable>
        {cert.code}
      </RNText>
      {cert.title ? <RNText style={[type.headline, styles.white]}>{cert.title}</RNText> : null}
      <RNText style={[type.title2, styles.white]}>{cert.balance === cert.amount ? formatMoney(cert.amount) : `${formatMoney(cert.balance)} из ${formatMoney(cert.amount)}`}</RNText>
      {cert.validUntil ? <RNText style={[type.footnote, styles.muted]}>{`до ${dateText(cert.validUntil)}`}</RNText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { margin: space.md, padding: space.lg, gap: 6, borderRadius: 22, borderCurve: 'continuous', backgroundColor: '#3B2A7A' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  chipText: { fontWeight: '700' },
  code: { fontSize: 30, fontWeight: '800', letterSpacing: 1.5, color: 'white', fontVariant: ['tabular-nums'] },
  white: { color: 'white' },
  muted: { color: 'rgba(255,255,255,0.7)' },
});
