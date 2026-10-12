import { Form, Section, Text } from '@expo/ui/swift-ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { deleteCustomer, saveCustomer, type CustomerRow } from '@/lib/clients-api';
import { haptic } from '@/lib/haptics';
import { cleanPhone, pickContact } from '@/lib/phone-book';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Новый заказчик или правка: имя контактного лица и телефон; удалить — с подтверждением. */
export default function CustomerSheet() {
  const params = useLocalSearchParams<{ customerId?: string; name?: string; phone?: string }>();
  // Отдельного GET у заказчиков нет — данные строки приходят параметрами из списка.
  const customer: CustomerRow | undefined = params.customerId
    ? { id: params.customerId, name: params.name || null, phone: params.phone || null, createdAt: '' }
    : undefined;
  return <CustomerForm initial={customer} />;
}

function CustomerForm({ initial }: { initial: CustomerRow | undefined }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  // Контакт из адресной книги пересоздаёт поля — иначе они держат прежний текст.
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const empty = !name.trim() && !phone.trim();

  const save = async () => {
    if (empty) return;
    haptic.medium();
    setBusy(true);
    try {
      await saveCustomer(initial?.id ?? null, { name: name.trim() || null, phone: phone.trim() || null });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Заказчик не сохранён', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    initial &&
    Alert.alert('Удалить заказчика?', 'Мероприятия сохранят его имя и телефон.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          deleteCustomer(initial.id)
            .then(() => {
              haptic.success();
              // Удалили с карточки — её больше нет, возвращаемся к списку.
              router.dismissTo('/manage/customers');
            })
            .catch((error: unknown) => {
              haptic.error();
              Alert.alert('Заказчик не удалён', errorText(error));
            }),
      },
    ]);

  /** Имя и телефон из адресной книги — системный выбор карточки. */
  const fromContacts = () => {
    void pickContact().then((contact) => {
      if (!contact) return;
      if (contact.name) setName(contact.name);
      if (contact.phone) setPhone(cleanPhone(contact.phone));
      setVersion((v) => v + 1);
      haptic.success();
    });
  };

  return (
    <>
      <EditorToolbar title={initial ? 'Заказчик' : 'Новый заказчик'} canSave={!empty} busy={busy} onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section title="Контакт" footer={<Text>Имя контактного лица и телефон — хотя бы одно из двух.</Text>}>
            <FieldRow key={`name-${version}`} value={name} placeholder="Имя контактного лица" autoFocus={!initial} onChange={setName} />
            <FieldRow key={`phone-${version}`} value={phone} placeholder="+7 900 000-00-00" keyboard="phone-pad" onChange={setPhone} />
            <ActionRow title="Взять из контактов" icon="person.crop.circle.badge.plus" onPress={fromContacts} />
          </Section>
          {initial && (
            <Section>
              <ActionRow title="Удалить заказчика" icon="trash" destructive onPress={remove} />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
