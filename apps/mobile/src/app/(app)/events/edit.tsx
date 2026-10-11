import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { CustomerSection } from '@/components/event-form/customer-section';
import { DetailsSection } from '@/components/event-form/details-section';
import { buildInput, effectiveMode, initialForm, type FormState } from '@/components/event-form/form-state';
import { MinicapMoney, MinicapTitle } from '@/components/event-form/minicap-section';
import { endTimeFor, formTotal, KIND_LABEL, type FormKind } from '@/components/event-form/model';
import { formStyles } from '@/components/event-form/parts';
import { PaymentSection } from '@/components/event-form/payment-section';
import { WhenSection } from '@/components/event-form/when-section';
import { WhereSection, type ZoneOption } from '@/components/event-form/where-section';
import { PrimaryButton, SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { useDebounced } from '@/components/player-picker';
import {
  createEvent,
  createMinicap,
  eventErrorMessage,
  toDateString,
  toTimeString,
  updateEvent,
  updateMinicap,
  useEvent,
  useEventAvailability,
  useEventRates,
  useStaffList,
  type EventRow,
} from '@/lib/events-api';
import { formatMoney, toNumber } from '@/lib/format';
import { pushEventToCalendar } from '@/lib/calendar-sync';
import { useDevicePrefs } from '@/lib/device-prefs';
import { haptic } from '@/lib/haptics';
import { KEYBOARD_DISMISS } from '@/lib/layout';
import { useSpaces } from '@/lib/pos-api';
import { parseAmount } from '@/lib/shift-api';
import { colors, space, type } from '@/lib/theme';

/** Пауза перед проверкой занятости зон, пока крутят время и длительность. */
const AVAILABILITY_DEBOUNCE_MS = 350;
/** Шторка уезжает ~400 мс — следом открывается карточка нового миникапа. */
const AFTER_SHEET_MS = 420;

/**
 * Одна форма мероприятия: в клубе, выезд или миникап. `/events/edit` — новое
 * (`format=minicap` сразу выбирает миникап), `/events/edit?eventId=…` — правка любого,
 * в том числе подтверждённой брони с сайта и миникапа.
 */
export default function EventEditSheet() {
  const { eventId, format } = useLocalSearchParams<{ eventId?: string; format?: string }>();
  const router = useRouter();
  const event = useEvent(eventId);

  if (eventId && !event.data) {
    return (
      <View style={styles.loading}>
        {event.isError ? <Text style={[type.body, sheetStyles.secondary]}>{eventErrorMessage(event.error.message)}</Text> : <ActivityIndicator />}
      </View>
    );
  }

  return (
    <EventForm
      key={event.data?.id ?? 'new'}
      initial={event.data}
      format={format}
      onClose={() => router.back()}
      onMinicapCreated={(created) => {
        router.back();
        // Состав (игроки и судья) набирается в карточке миникапа.
        setTimeout(() => router.push({ pathname: '/events/[eventId]', params: { eventId: created.id } }), AFTER_SHEET_MS);
      }}
    />
  );
}

/** Вид меняется между клубом и выездом; миникап остаётся миникапом, обычное в миникап не превращается. */
function kindOptions(initial: EventRow | undefined): FormKind[] {
  if (!initial) return ['titan', 'exit', 'minicap'];
  return initial.format === 'minicap' ? [] : ['titan', 'exit'];
}

function EventForm({
  initial,
  format,
  onClose,
  onMinicapCreated,
}: {
  initial: EventRow | undefined;
  format: string | undefined;
  onClose: () => void;
  onMinicapCreated: (event: EventRow) => void;
}) {
  const insets = useSafeAreaInsets();
  const spaces = useSpaces();
  const staff = useStaffList();
  const rates = useEventRates();
  const [form, setForm] = useState<FormState>(() => initialForm(initial, format));
  const [busy, setBusy] = useState(false);
  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }));

  const isMinicap = form.kind === 'minicap';
  const mode = effectiveMode(form);
  const staffList = staff.data ?? [];
  const date = toDateString(form.start);

  // Занятость зон — на дату, начало и конец; пока время крутят, запрос ждёт паузы.
  const availabilityKey = form.kind === 'titan' ? `${date}|${toTimeString(form.start)}|${endTimeFor(form.start, form.minutes)}` : null;
  const settledKey = useDebounced(availabilityKey, AVAILABILITY_DEBOUNCE_MS);
  const [checkDate, checkStart, checkEnd] = settledKey?.split('|') ?? [];
  const availability = useEventAvailability(
    settledKey && checkDate && checkStart
      ? { date: checkDate, startTime: checkStart, endTime: checkEnd ?? null, plannedHours: null, excludeEventId: initial?.id }
      : null,
  );
  const zones: ZoneOption[] = availability.data ?? spaces.data ?? [];
  const zone = zones.find((z) => z.id === form.spaceId) ?? null;

  const total = formTotal({
    mode,
    amount: parseAmount(form.amountText),
    minutes: form.minutes,
    rates: rates.data,
    hourlyRate: zone ? toNumber(zone.hourlyRate) : null,
  });
  const verb = initial ? 'Сохранить' : 'Создать';
  const plainTitle = initial ? 'Сохранить' : isMinicap ? 'Создать миникап' : 'Создать мероприятие';
  const buttonTitle = busy
    ? 'Сохраняем…'
    : !isMinicap && total.value > 0
      ? `${verb} · ${total.approximate ? '≈ ' : ''}${formatMoney(total.value)}`
      : plainTitle;

  const save = async () => {
    const built = buildInput(form, { initial, staffAvailable: staffList.length > 0 });
    if (!built.ok) return Alert.alert(built.title, built.message);

    haptic.medium();
    setBusy(true);
    try {
      let saved: EventRow;
      if (built.minicap) saved = initial ? await updateMinicap(initial.id, built.input) : await createMinicap(built.input);
      else saved = initial ? await updateEvent(initial.id, built.input) : await createEvent(built.input);
      // Календарь телефона обновляем сразу — не дожидаясь общей синхронизации.
      if (useDevicePrefs.getState().calendarSync) void pushEventToCalendar(saved);
      haptic.success();
      if (built.minicap && !initial) onMinicapCreated(saved);
      else onClose();
    } catch (error) {
      haptic.error();
      Alert.alert(
        built.minicap ? 'Миникап не сохранён' : 'Мероприятие не сохранено',
        eventErrorMessage(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  };

  const kinds = kindOptions(initial);
  const header = initial ? (initial.format === 'minicap' ? 'Миникап' : 'Мероприятие') : 'Новое мероприятие';

  return (
    <KeyboardAvoidingView behavior="padding" style={formStyles.flex}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={KEYBOARD_DISMISS}
        showsVerticalScrollIndicator={false}>
        <SheetHeader title={header} onClose={onClose} />

        {kinds.length > 1 && (
          <Host matchContents={{ vertical: true }} style={formStyles.stretch}>
            <Picker
              selection={form.kind}
              onSelectionChange={(value) => {
                haptic.selection();
                patch({ kind: value as FormKind });
              }}
              modifiers={[pickerStyle('segmented')]}>
              {kinds.map((kind) => (
                <SwiftText key={kind} modifiers={[tag(kind)]}>
                  {KIND_LABEL[kind]}
                </SwiftText>
              ))}
            </Picker>
          </Host>
        )}

        {isMinicap ? (
          <MinicapTitle value={form.title} onChange={(title) => patch({ title })} autoFocus={!initial && format === 'minicap'} />
        ) : (
          <CustomerSection
            name={form.customerName}
            phone={form.customerPhone}
            required={form.kind === 'titan'}
            onName={(customerName) => patch({ customerName })}
            onPhone={(customerPhone) => patch({ customerPhone })}
          />
        )}

        <WhenSection
          start={form.start}
          onStart={(start) => patch({ start })}
          minutes={isMinicap ? null : form.minutes}
          onMinutes={(minutes) => patch({ minutes })}
        />

        <WhereSection
          kind={form.kind}
          date={date}
          zones={zones}
          spaceId={form.spaceId}
          onSpace={(spaceId) => patch({ spaceId })}
          address={form.address}
          onAddress={(address) => patch({ address })}
        />

        {isMinicap ? (
          <>
            <MinicapMoney fee={form.fee} onFee={(fee) => patch({ fee })} costs={form.costs} onCosts={(costs) => patch({ costs })} />
            {!initial && <Text style={[type.footnote, styles.hint]}>Игроков и судью добавите в карточке миникапа — сразу после создания.</Text>}
          </>
        ) : (
          <>
            <PaymentSection
              kind={form.kind}
              mode={mode}
              onMode={(billing) => patch({ billing })}
              amountText={form.amountText}
              onAmount={(amountText) => patch({ amountText })}
              minutes={form.minutes}
              rates={rates.data}
              zone={zone}
            />
            <DetailsSection
              staff={staffList}
              responsibleRequired={form.kind === 'exit'}
              responsibleId={form.responsibleId}
              onResponsible={(responsibleId) => patch({ responsibleId })}
              guests={form.guests}
              onGuests={(guests) => patch({ guests })}
              comment={form.comment}
              onComment={(comment) => patch({ comment })}
            />
          </>
        )}

        <PrimaryButton title={buttonTitle} icon="checkmark" busy={busy} onPress={() => void save()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  content: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  hint: { color: colors.secondaryLabel, textAlign: 'center', paddingHorizontal: space.lg },
});
