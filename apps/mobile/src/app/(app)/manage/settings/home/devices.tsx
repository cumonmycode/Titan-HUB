import { Button, ContentUnavailableView, Form, HStack, Image, ProgressView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FormHost, primary, SearchRow, secondary } from '@/components/native-form';
import type { HaDevice } from '@/lib/home-assistant';
import { haptic } from '@/lib/haptics';
import { MAX_DEVICE_NAME, saveZones, useHaDevices, useSmartHome, useSmartHomeToken, type DeviceKind } from '@/lib/smart-home-api';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Сколько устройств помещается в помещение (как на сервере). */
const LIMIT: Record<DeviceKind, number> = { light: 16, climate: 4 };
const NO_AREA = 'Без помещения в Home Assistant';

const stateText = (state: string) =>
  state === 'on' ? 'вкл.' : state === 'off' ? 'выкл.' : state === 'unavailable' || state === 'unknown' ? 'недоступно' : state;

/**
 * Выбор устройств помещения из Home Assistant: телефон сам спрашивает у HA список
 * (по Wi‑Fi клуба), группирует по помещениям HA и отмечает, какие устройства уже стоят
 * в других помещениях HUB. «Готово» сохраняет отмеченные — подписи уже выбранных
 * устройств не теряются.
 */
export default function SmartHomeDevicesScreen() {
  const { zoneId, kind = 'light' } = useLocalSearchParams<{ zoneId: string; kind?: DeviceKind }>();
  const router = useRouter();
  const config = useSmartHome();
  const token = useSmartHomeToken();
  const devices = useHaDevices(config.data?.url ?? null, token);
  const zones = config.data?.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId);
  const key = kind === 'climate' ? 'climates' : 'lights';
  const current = zone?.[key] ?? [];
  const [selected, setSelected] = useState<string[]>(() => current.map((d) => d.entityId));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const fits = (device: HaDevice) => (kind === 'climate' ? device.domain === 'climate' : device.domain !== 'climate');
  const available = (devices.data?.devices ?? []).filter(fits);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? available.filter((d) => d.name.toLowerCase().includes(q) || d.entityId.includes(q) || (d.area ?? '').toLowerCase().includes(q))
    : available;

  // По помещениям Home Assistant: одноимённое помещение — первым, «без помещения» — в конце.
  const groups = new Map<string, HaDevice[]>();
  for (const device of filtered) groups.set(device.area ?? NO_AREA, [...(groups.get(device.area ?? NO_AREA) ?? []), device]);
  const own = zone?.name.trim().toLowerCase();
  const rank = (area: string) => (area.toLowerCase() === own ? 0 : area === NO_AREA ? 2 : 1);
  const sections = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'ru'));

  const usedIn = new Map<string, string>();
  for (const other of zones) if (other.id !== zoneId) for (const d of other[key]) usedIn.set(d.entityId, other.name);
  // Выбранные раньше, но пропавшие из Home Assistant (переименовали, удалили) — чтобы их можно было снять.
  const missing = devices.data ? current.filter((d) => !available.some((a) => a.entityId === d.entityId)) : [];

  const changed = selected.length !== current.length || selected.some((id, i) => current[i]?.entityId !== id);

  const toggle = (entityId: string) => {
    haptic.selection();
    if (selected.includes(entityId)) {
      setSelected(selected.filter((id) => id !== entityId));
      return;
    }
    if (selected.length >= LIMIT[kind]) {
      Alert.alert('Слишком много', `В одно помещение — до ${LIMIT[kind]} устройств этого вида.`);
      return;
    }
    setSelected([...selected, entityId]);
  };

  const save = async () => {
    if (!zone) return;
    const known = new Map(current.map((d) => [d.entityId, d]));
    const fromHa = new Map(available.map((d) => [d.entityId, d]));
    const next = selected.map((id) => known.get(id) ?? { entityId: id, name: (fromHa.get(id)?.name ?? id).slice(0, MAX_DEVICE_NAME) });
    setBusy(true);
    try {
      await saveZones(zones.map((z) => (z.id === zone.id ? { ...z, [key]: next } : z)));
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const row = (entityId: string, name: string, detail: string) => {
    const on = selected.includes(entityId);
    return (
      <Button key={entityId} onPress={() => toggle(entityId)}>
        <HStack spacing={12}>
          <Image systemName={kind === 'climate' ? 'snowflake' : 'lightbulb.fill'} size={17} color={kind === 'climate' ? '#32ADE6' : '#FFCC00'} />
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[primary, lineLimit(2)]}>{name}</Text>
            <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(2)]}>{detail}</Text>
          </VStack>
          <Spacer />
          {on ? <Image systemName="checkmark" size={16} color={colors.accent} /> : null}
        </HStack>
      </Button>
    );
  };

  const detailOf = (device: HaDevice) => {
    const other = usedIn.get(device.entityId);
    return [device.entityId, stateText(device.state), other ? `уже в «${other}»` : null].filter(Boolean).join(' · ');
  };

  return (
    <>
      <EditorToolbar
        title={`${kind === 'climate' ? 'Кондиционеры' : 'Свет'} · ${zone?.name ?? ''}`}
        canSave={changed && !!zone}
        busy={busy}
        saveLabel="Готово"
        onSave={() => void save()}
      />
      <FormHost>
        <Form modifiers={[refreshable(async () => void (await devices.refetch()))]}>
          <Section>
            <SearchRow placeholder="Название или помещение" onChange={setQuery} />
          </Section>

          {missing.length > 0 && (
            <Section title="Нет в Home Assistant" footer={<Text>Устройство переименовали или удалили в Home Assistant — снимите отметку.</Text>}>
              {missing.map((d) => row(d.entityId, d.name, d.entityId))}
            </Section>
          )}

          {devices.isLoading ? (
            <Section>
              <ProgressView />
            </Section>
          ) : devices.error ? (
            <Section>
              <ContentUnavailableView title="Нет связи с Home Assistant" systemImage="wifi.slash" description={errorText(devices.error)} />
              <ActionRow title="Повторить" icon="arrow.clockwise" onPress={() => void devices.refetch()} />
            </Section>
          ) : sections.length === 0 ? (
            <Section>
              <ContentUnavailableView
                title={q ? 'Ничего не нашли' : 'Устройств нет'}
                systemImage={kind === 'climate' ? 'snowflake' : 'lightbulb'}
                description={q ? undefined : kind === 'climate' ? 'В Home Assistant нет кондиционеров (climate).' : 'В Home Assistant нет света и выключателей.'}
              />
            </Section>
          ) : (
            sections.map(([area, list]) => (
              <Section key={area} title={area}>
                {list.map((device) => row(device.entityId, device.name, detailOf(device)))}
              </Section>
            ))
          )}
        </Form>
      </FormHost>
    </>
  );
}
