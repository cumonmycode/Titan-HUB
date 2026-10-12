import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { TextRow } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { EMPTY_CONTACTS, saveSite, useSiteConfig, type SiteContacts } from '@/lib/site-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Field = { key: keyof SiteContacts; label: string; placeholder: string; keyboard: 'phone-pad' | 'email-address' | 'url' };

const CONTACT: Field[] = [
  { key: 'phone', label: 'Телефон', placeholder: '+7 900 000-00-00', keyboard: 'phone-pad' },
  { key: 'email', label: 'Почта', placeholder: 'info@club.ru', keyboard: 'email-address' },
];
const SOCIAL: Field[] = [
  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/club', keyboard: 'url' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'https://wa.me/79000000000', keyboard: 'url' },
  { key: 'channel', label: 'Канал', placeholder: 'https://t.me/channel', keyboard: 'url' },
  { key: 'vk', label: 'ВКонтакте', placeholder: 'https://vk.com/club', keyboard: 'url' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/club', keyboard: 'url' },
];

/**
 * Контакты клуба на сайте: телефон и почта — в шапке, подвале и на странице
 * «Контакты»; ссылки — в подвале и разметке для поисковиков. Телефон получает и
 * гость в сообщении бота, если заявку отклонили. Каждое поле сохраняется сразу.
 */
export default function SiteContactsScreen() {
  const config = useSiteConfig();
  const [draft, setDraft] = useState<SiteContacts | null>(null);

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }
  const contacts = draft ?? config.data.contacts ?? EMPTY_CONTACTS;

  const commit = (key: keyof SiteContacts, value: string) => {
    if (SOCIAL.some((f) => f.key === key) && value && !/^https:\/\/\S+$/.test(value)) {
      Alert.alert('Нужна ссылка', 'Ссылка должна начинаться с https:// — например, https://t.me/club.');
      return;
    }
    const next = { ...contacts, [key]: value };
    setDraft(next);
    saveSite({ contacts: next })
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setDraft(null);
        Alert.alert('Контакты не сохранены', errorText(error));
      });
  };

  const row = (f: Field) => (
    <TextRow key={f.key} label={f.label} value={contacts[f.key]} placeholder={f.placeholder} keyboard={f.keyboard} capitalize="never" maxLength={300} onCommit={(v) => commit(f.key, v)} />
  );

  return (
    <>
      <Stack.Title>Контакты</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Связь" footer={<Text>Телефон и почта видны в шапке, подвале и на странице «Контакты».</Text>}>
            {CONTACT.map(row)}
          </Section>
          <Section title="Мессенджеры и соцсети" footer={<Text>Пустое поле — ссылки нет на сайте. Изменения появятся на сайте в течение минуты.</Text>}>
            {SOCIAL.map(row)}
          </Section>
        </Form>
      </Host>
    </>
  );
}
