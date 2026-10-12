import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AcquirerSections, ReceiptSections, usePaymentEditor } from '@/components/integrations/payment-sections';
import { ActionRow, FieldRow, LinkRow } from '@/components/native-form';
import { Text as RNText } from '@/components/text';
import { useIntegrations } from '@/lib/admin-api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { connectGomafia, productById, removeIntegration, saveIntegrationKeys, statusOf, useGomafiaStatus, type IntegrationProduct } from '@/lib/integrations';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Одна интеграция — всё про неё в одном месте: что даёт, подключение с подсказками,
 * у установленной — ключи (маской), настройки сервиса (оплата и чеки, Tai, клуб GoMafia)
 * и «Отключить».
 */
export default function IntegrationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const product = productById(id);
  const host = useSession((s) => s.club?.host ?? '');
  const integrations = useIntegrations(true);
  const gomafia = useGomafiaStatus(product?.kind === 'gomafia');
  const payment = usePaymentEditor();
  const [values, setValues] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!product) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ContentUnavailableView title="Интеграция не найдена" systemImage="puzzlepiece.extension" />
      </Host>
    );
  }
  if (!integrations.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }

  const items = integrations.data;
  const status = statusOf(product, items, gomafia.data);
  const keyOf = (key: string) => items.find((i) => i.key === key);
  const showForm = !status.installed || editing || (product.kind === 'keys' && !status.complete);
  const ready =
    product.kind === 'gomafia'
      ? !!(values.login?.trim() && values.password?.trim())
      : product.fields.some((f) => values[f.key]?.trim()) && product.fields.every((f) => f.optional || values[f.key]?.trim() || keyOf(f.key)?.configured);

  const submit = async () => {
    setBusy(true);
    try {
      if (product.kind === 'gomafia') await connectGomafia(values);
      else await saveIntegrationKeys(Object.fromEntries(product.fields.map((f) => [f.key, values[f.key] ?? ''])));
      haptic.success();
      setValues({});
      setVersion((v) => v + 1);
      setEditing(false);
    } catch (error) {
      haptic.error();
      Alert.alert('Не подключилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () =>
    Alert.alert(`Отключить ${product.name}?`, 'Ключи удалятся с сервера. Подключить снова можно из каталога.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () =>
          void removeIntegration(product).then(
            () => {
              haptic.success();
              router.back();
            },
            (error: unknown) => Alert.alert('Не отключилось', errorText(error)),
          ),
      },
    ]);

  const changeClub = () =>
    promptText('Ссылка на клуб', 'Например, gomafia.pro/club/49', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Сохранить',
        onPress: (value) => {
          if (value?.trim()) void connectGomafia({ clubUrl: value }).then(() => haptic.success(), (error: unknown) => Alert.alert('Клуб не найден', errorText(error)));
        },
      },
    ]);

  return (
    <>
      <Stack.Title>{product.name}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section>
            <RNHostView matchContents>
              <Hero product={product} installed={status.installed} complete={status.complete} />
            </RNHostView>
          </Section>

          {showForm ? (
            <>
              {product.fields.map((field) => {
                const current = keyOf(field.key);
                const placeholder = current?.configured ? `${current.masked ?? '••••'} — не менять` : field.optional ? `${field.placeholder} (необязательно)` : field.placeholder;
                return (
                  <Section key={field.key} title={field.label} footer={<Text>{field.hint}</Text>}>
                    <FieldRow
                      key={`${field.key}-${version}`}
                      value=""
                      placeholder={placeholder}
                      secure={field.secure}
                      onChange={(next) => setValues((all) => ({ ...all, [field.key]: next }))}
                    />
                  </Section>
                );
              })}
              <Section footer={<Text>Ключи хранятся на сервере зашифрованными и не показываются целиком.</Text>}>
                <ActionRow title={busy ? 'Проверяем…' : status.installed ? 'Сохранить ключи' : 'Подключить'} icon="checkmark.circle.fill" disabled={!ready || busy} onPress={() => void submit()} />
                {editing ? <ActionRow title="Отмена" icon="xmark.circle" onPress={() => setEditing(false)} /> : null}
              </Section>
            </>
          ) : product.kind === 'gomafia' ? (
            <Section title="Подключение">
              <LinkRow title="Аккаунт" value={gomafia.data?.loginMasked ?? '—'} chevron={false} />
              <LinkRow title="Клуб" value={status.detail} chevron={false} />
              <ActionRow title="Сменить клуб" icon="arrow.triangle.2.circlepath" onPress={changeClub} />
              <ActionRow title="Войти заново" icon="person.badge.key" onPress={() => setEditing(true)} />
            </Section>
          ) : (
            <Section title="Ключи">
              {product.fields.map((field) => {
                const current = keyOf(field.key);
                return <LinkRow key={field.key} title={field.label} value={current?.configured ? (current.masked ?? '••••') : 'не задан'} valueColor={current?.configured ? undefined : colors.tertiaryLabel} chevron={false} />;
              })}
              <ActionRow title="Изменить ключи" icon="key.fill" onPress={() => setEditing(true)} />
            </Section>
          )}

          {status.installed && product.id === 'poll_bot' ? (
            <Section>
              <LinkRow icon="sparkles" color="#8B5CF6" title="Настройки Tai" subtitle="Голос, клиенты в Telegram, групповые чаты" onPress={() => router.push('/manage/tai')} />
            </Section>
          ) : null}
          {status.installed && product.provider && payment.data ? <AcquirerSections provider={product.provider} data={payment.data} save={payment.save} host={host} /> : null}
          {status.installed && product.fiscal && payment.data?.fiscalStandalone ? <ReceiptSections data={payment.data} save={payment.save} /> : null}

          {status.installed ? (
            <Section>
              <ActionRow title="Отключить" icon="xmark.circle" destructive onPress={disconnect} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}

/** Шапка: иконка, название, статус и что даёт интеграция. */
function Hero({ product, installed, complete }: { product: IntegrationProduct; installed: boolean; complete: boolean }) {
  const state = !installed ? null : complete ? { text: 'Установлено', color: colors.green } : { text: 'Введены не все ключи', color: colors.orange };
  return (
    <View style={styles.hero}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: product.color }]}>
          <SymbolView name={product.symbol} size={28} weight="semibold" tintColor="white" />
        </View>
        <View style={styles.flex}>
          <RNText style={[type.title3, styles.label]}>{product.name}</RNText>
          <RNText style={[type.subhead, styles.secondary]}>{product.blurb}</RNText>
          {state ? <RNText style={[type.footnote, styles.state, { color: state.color }]}>{state.text}</RNText> : null}
        </View>
      </View>
      <RNText style={[type.subhead, styles.label]}>{product.about}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  icon: { width: 60, height: 60, borderRadius: 15, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  state: { fontWeight: '600', marginTop: 2 },
});
