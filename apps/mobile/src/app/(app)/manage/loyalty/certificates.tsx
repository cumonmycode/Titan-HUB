import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';

import { ActionRow, LinkRow, SearchRow } from '@/components/native-form';
import { useDebounced } from '@/components/player-picker';
import { ToolbarButton } from '@/components/toolbar';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { CERT_SCOPE_LABEL, CERT_STATUS_LOOK, useCertificates, useCertificateSeries, type Certificate } from '@/lib/loyalty-api';

type Filter = 'active' | 'all' | 'used' | 'expired';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'Действуют' },
  { key: 'used', label: 'Использованы' },
  { key: 'expired', label: 'Истекли' },
  { key: 'all', label: 'Все' },
];
const until = (iso: string) => `до ${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;

const matches = (c: Certificate, f: Filter) => (f === 'all' ? true : f === 'expired' ? c.status === 'expired' || c.status === 'void' : c.status === f);

/**
 * Сертификаты: серии (диапазоны номеров) и сами сертификаты с фильтром и поиском по
 * номеру, получателю или названию. «+» — выпустить один со своим номером или серию.
 */
export default function CertificatesScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [seriesOnly, setSeriesOnly] = useState<string | null>(null);
  const q = useDebounced(query.trim(), 250);
  const [filter, setFilter] = useState<Filter>('active');
  const list = useCertificates(q);
  const series = useCertificateSeries();
  const shown = (list.data ?? []).filter((c) => matches(c, filter) && (!seriesOnly || c.series === seriesOnly));

  const open = (c: Certificate) => router.push({ pathname: '/manage/loyalty/certificate', params: { certificateId: c.id } });

  return (
    <>
      <Stack.Title>Сертификаты</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton
          icon="plus"
          accessibilityLabel="Выпустить сертификаты"
          onPress={() => {
            haptic.light();
            router.push('/manage/loyalty/certificate-new');
          }}
        />
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([list.refetch(), series.refetch()])))]}>
          <Section>
            <SearchRow placeholder="Номер, получатель или название" onChange={setQuery} />
            <Picker selection={filter} onSelectionChange={(v) => setFilter(v as Filter)} modifiers={[pickerStyle('segmented')]}>
              {FILTERS.map((f) => (
                <Text key={f.key} modifiers={[tag(f.key)]}>
                  {f.label}
                </Text>
              ))}
            </Picker>
          </Section>

          {!q && !seriesOnly && (series.data ?? []).length > 0 && (
            <Section title="Серии" footer={<Text>Нажмите на серию — покажем только её номера.</Text>}>
              {(series.data ?? []).map((s) => (
                <LinkRow
                  key={s.series}
                  icon="square.stack.3d.up.fill"
                  color="#AF52DE"
                  title={s.title ? `${s.series} · ${s.title}` : s.series}
                  subtitle={`${s.first} … ${s.last} · по ${formatMoney(s.nominal)}`}
                  value={`${s.active} из ${s.total}`}
                  onPress={() => setSeriesOnly(s.series)}
                />
              ))}
            </Section>
          )}

          {seriesOnly && (
            <Section>
              <ActionRow title={`Серия ${seriesOnly} · показать все`} icon="xmark.circle" onPress={() => setSeriesOnly(null)} />
            </Section>
          )}

          <Section title={q ? `Найдено: ${shown.length}` : undefined} footer={<Text>Сертификатом платят в кассе — способ оплаты «Сертификат», номер вводит кассир.</Text>}>
            {list.isLoading ? (
              <ProgressView />
            ) : shown.length === 0 ? (
              <ContentUnavailableView
                title={list.data?.length ? 'Ничего не нашли' : 'Сертификатов пока нет'}
                systemImage="giftcard"
                description={list.data?.length ? 'Поменяйте фильтр или запрос.' : 'Выпустите один со своим номером или сразу серию: TK-0001…TK-0100.'}
              />
            ) : (
              shown.map((c) => (
                <LinkRow
                  key={c.id}
                  icon="giftcard.fill"
                  color={CERT_STATUS_LOOK[c.status].color}
                  title={c.code}
                  subtitle={
                    [c.title, c.scope === 'all' ? null : CERT_SCOPE_LABEL[c.scope].toLowerCase(), c.recipient, c.validUntil ? until(c.validUntil) : null, c.status === 'active' ? null : CERT_STATUS_LOOK[c.status].label.toLowerCase()]
                      .filter(Boolean)
                      .join(' · ') || 'На всё'
                  }
                  value={c.balance === c.amount ? formatMoney(c.amount) : `${formatMoney(c.balance)} из ${formatMoney(c.amount)}`}
                  onPress={() => open(c)}
                />
              ))
            )}
            <ActionRow title="Выпустить сертификаты" icon="plus.circle.fill" onPress={() => router.push('/manage/loyalty/certificate-new')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
