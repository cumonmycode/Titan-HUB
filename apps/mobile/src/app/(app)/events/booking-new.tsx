import { DatePicker, Form, Picker, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost, InputRow } from '@/components/native-form';
import { createManualBooking, MANUAL_CHANNELS, type ManualBooking, type ManualChannel } from '@/lib/bookings-api';
import { defaultEventStart, toDateString, toTimeString } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';

type Kind = ManualBooking['kind'];

const KINDS: { key: Kind; label: string }[] = [
  { key: 'game', label: 'Запись на игру' },
  { key: 'event', label: 'Мероприятие' },
  { key: 'message', label: 'Обращение' },
];

const GUESTS_MAX = 500;

/**
 * Заявка вручную: гость позвонил, написал в директ или пришёл в клуб. Попадает в те же
 * «Заявки», что и с сайта, с пометкой канала и того, кто её завёл.
 */
export default function BookingNewSheet() {
  const router = useRouter();
  const club = useClubKey();
  // Из «Событий» — заявка на мероприятие, из «Заявок» — запись на игру.
  const { kind: kindParam } = useLocalSearchParams<{ kind?: Kind }>();
  const [kind, setKind] = useState<Kind>(kindParam === 'event' || kindParam === 'message' ? kindParam : 'game');
  const [channel, setChannel] = useState<ManualChannel>('phone');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<Date>(defaultEventStart);
  const [guests, setGuests] = useState('');
  const [location, setLocation] = useState<'titan' | 'exit'>('titan');
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const canSave = name.trim().length > 0 && (kind !== 'message' || comment.trim().length > 0);

  const save = async () => {
    const guestCount = guests.trim() ? Number.parseInt(guests, 10) : undefined;
    if (guestCount !== undefined && (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > GUESTS_MAX)) {
      Alert.alert('Проверьте число гостей', `От 1 до ${GUESTS_MAX}.`);
      return;
    }
    haptic.medium();
    setBusy(true);
    try {
      await createManualBooking(club, {
        kind,
        channel,
        name: name.trim(),
        phone: phone.trim() || undefined,
        title: title.trim() || undefined,
        ...(kind === 'message' ? {} : { date: toDateString(start), time: toTimeString(start) }),
        guests: kind === 'message' ? undefined : guestCount,
        location: kind === 'event' ? location : undefined,
        address: kind === 'event' && location === 'exit' ? address.trim() || undefined : undefined,
        comment: comment.trim() || undefined,
      });
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Заявка не сохранена', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Заявка вручную" canSave={canSave} busy={busy} saveLabel="Добавить" onSave={() => void save()} />
      <FormHost>
        <Form>
          <Section footer={<Text>Откуда пришла заявка — увидите в её карточке и в списке.</Text>}>
            <Picker
              label="Откуда"
              selection={channel}
              onSelectionChange={(value) => {
                haptic.selection();
                setChannel(value as ManualChannel);
              }}
              modifiers={[pickerStyle('menu')]}>
              {MANUAL_CHANNELS.map((c) => (
                <Text key={c.key} modifiers={[tag(c.key)]}>
                  {c.label}
                </Text>
              ))}
            </Picker>
            <Picker
              label="Что нужно"
              selection={kind}
              onSelectionChange={(value) => {
                haptic.selection();
                setKind(value as Kind);
              }}
              modifiers={[pickerStyle('menu')]}>
              {KINDS.map((k) => (
                <Text key={k.key} modifiers={[tag(k.key)]}>
                  {k.label}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title="Гость">
            <InputRow label="Имя" value={name} placeholder="Как зовут" onChange={setName} />
            <InputRow label="Телефон" value={phone} placeholder="+7…" keyboard="phone-pad" onChange={setPhone} />
          </Section>

          {kind !== 'message' ? (
            <Section title="Когда и сколько">
              <DatePicker title="Начало" selection={start} displayedComponents={['date', 'hourAndMinute']} onDateChange={setStart} />
              <InputRow label="Гостей" value={guests} placeholder="1" keyboard="numeric" onChange={setGuests} />
            </Section>
          ) : null}

          {kind === 'event' ? (
            <Section title="Мероприятие">
              <InputRow label="Название" value={title} placeholder="День рождения, корпоратив…" onChange={setTitle} />
              <Picker
                label="Где"
                selection={location}
                onSelectionChange={(value) => {
                  haptic.selection();
                  setLocation(value as 'titan' | 'exit');
                }}
                modifiers={[pickerStyle('segmented')]}>
                <Text modifiers={[tag('titan')]}>В клубе</Text>
                <Text modifiers={[tag('exit')]}>Выезд</Text>
              </Picker>
              {location === 'exit' ? <InputRow label="Адрес" value={address} placeholder="Куда ехать" onChange={setAddress} /> : null}
            </Section>
          ) : null}

          <Section title={kind === 'message' ? 'Что спросили' : 'Комментарий'}>
            <FieldRow value={comment} placeholder={kind === 'message' ? 'Суть обращения' : 'Пожелания, детали'} multiline maxLength={1500} onChange={setComment} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
