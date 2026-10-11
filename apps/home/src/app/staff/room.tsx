// Устройства кабинки: сотрудник выбирает в Home Assistant до двух групп света и
// кондиционер и подписывает их для гостя. ?spaceId= — любая кабинка клуба
// (из экрана «Кабинки»); для своей кабинки сохраняем через tablet-токен.
import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CircleCheck, Circle, Lightbulb, Save, Search, Snowflake, Square, SquareCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { api, errorText } from '@/data/api';
import { invalidate, useHost } from '@/data/query';
import { useSession } from '@/data/session';
import { useSmartHome } from '@/data/smart-home';
import type { SmartDevice, SmartRoom } from '@/data/types';
import { haGetStates, type HaEntity, useHa } from '@/features/room/ha';
import { LIGHT_DOMAINS } from '@/features/room/room';
import { fetchBooths, saveBoothRoom, staffUnlocked, useStaff } from '@/features/staff/staff';
import { Background } from '@/ui/background';
import { Button } from '@/ui/button';
import { Loader } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Press } from '@/ui/press';
import { useKeyboardHeight } from '@/ui/keyboard';
import { ScreenHeader } from '@/ui/screen-header';
import { T } from '@/ui/text';
import { toast } from '@/ui/toast';
import { color, font, GUTTER, radius } from '@/ui/tokens';

const MAX_LIGHTS = 2;

const friendly = (e: HaEntity) => (typeof e.attributes.friendly_name === 'string' ? e.attributes.friendly_name : e.entity_id);
const domainOf = (id: string) => id.split('.')[0] ?? '';

export default function RoomSetupScreen() {
  const router = useRouter();
  const host = useHost();
  const params = useLocalSearchParams<{ spaceId?: string }>();
  const currentId = useSession((s) => s.space?.id ?? null);
  const spaceId = params.spaceId && params.spaceId !== currentId ? params.spaceId : null;
  const smart = useSmartHome();
  const booths = useQuery({ queryKey: [host, 'booths'], queryFn: fetchBooths, staleTime: 10_000, retry: false });
  const booth = (booths.data ?? []).find((b) => b.id === (spaceId ?? currentId));
  const initial = spaceId ? booth?.room : smart.data?.room;
  const status = useHa((s) => s.status);
  const touch = useStaff((s) => s.touch);
  const states = useQuery({ queryKey: ['ha-states', status], queryFn: haGetStates, enabled: status === 'connected', staleTime: 30_000 });

  if (!staffUnlocked()) return <Redirect href="/staff" />;

  const waiting = status === 'auth_failed'
    ? 'Home Assistant не принял токен — проверьте его в Titan HUB → Интеграции'
    : status === 'offline' ? 'Нет связи с Home Assistant — проверьте адрес и Wi-Fi планшета' : 'Подключаемся к Home Assistant…';

  return (
    <View style={styles.screen}>
      <Background />
      <ScreenHeader icon={ArrowLeft} label="Назад" onBack={() => router.back()} title={booth ? `Устройства: ${booth.name}` : 'Устройства кабинки'} caption="Что гость увидит в панели «Свет и климат»" />
      {status !== 'connected' ? (
        <Loader label={waiting} />
      ) : spaceId && booths.isError ? (
        <Loader label={errorText(booths.error)} />
      ) : states.isLoading || !initial ? (
        <Loader label="Загружаем устройства…" />
      ) : states.isError ? (
        <Loader label={errorText(states.error)} />
      ) : (
        <Editor key={JSON.stringify(initial)} initial={initial} spaceId={spaceId} entities={states.data ?? []} onTouch={touch} onSaved={() => router.back()} />
      )}
    </View>
  );
}

function Editor({ initial, spaceId, entities, onTouch, onSaved }: {
  initial: SmartRoom;
  /** Чужая кабинка (служебный токен сотрудника); null — кабинка этого планшета. */
  spaceId: string | null;
  entities: HaEntity[];
  onTouch: () => void;
  onSaved: () => void;
}) {
  const keyboard = useKeyboardHeight();
  const [lights, setLights] = useState<SmartDevice[]>(initial.lights);
  const [climate, setClimate] = useState<SmartDevice | null>(initial.climate);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const q = query.trim().toLowerCase();
  const match = (e: HaEntity) => !q || friendly(e).toLowerCase().includes(q) || e.entity_id.includes(q);
  const byName = (a: HaEntity, b: HaEntity) => friendly(a).localeCompare(friendly(b), 'ru');
  const lightEntities = entities.filter((e) => LIGHT_DOMAINS.includes(domainOf(e.entity_id)) && match(e)).sort(byName);
  const climateEntities = entities.filter((e) => domainOf(e.entity_id) === 'climate' && match(e)).sort(byName);

  const toggleLight = (e: HaEntity) => {
    onTouch();
    setLights((cur) => {
      if (cur.some((l) => l.entityId === e.entity_id)) return cur.filter((l) => l.entityId !== e.entity_id);
      if (cur.length >= MAX_LIGHTS) {
        toast(`Не больше ${MAX_LIGHTS} групп света — снимите одну`, 'warning');
        return cur;
      }
      return [...cur, { entityId: e.entity_id, name: cur.length === 0 ? 'Основной свет' : 'Подсветка' }];
    });
  };

  const save = async () => {
    onTouch();
    const room: SmartRoom = {
      lights: lights.map((l) => ({ ...l, name: l.name.trim() || 'Свет' })),
      climate: climate ? { ...climate, name: climate.name.trim() || 'Кондиционер' } : null,
    };
    setSaving(true);
    try {
      if (spaceId) await saveBoothRoom(spaceId, room);
      else await api.put('/pos/tablet/smart-home', room);
      await Promise.all([invalidate('smart-home'), invalidate('booths')]);
      toast('Устройства кабинки сохранены');
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: GUTTER + keyboard }]} keyboardShouldPersistTaps="handled" onScrollBeginDrag={onTouch} showsVerticalScrollIndicator={false}>
      <View style={[styles.search, glassStyle('control', radius.pill)]}>
        <Icon as={Search} size={20} tone={color.textTertiary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Поиск устройства" placeholderTextColor={color.textTertiary} style={styles.searchInput} />
      </View>

      <View style={styles.columns}>
        <View style={styles.column}>
          <T variant="overline" tone="secondary">Свет · до {MAX_LIGHTS} групп, только вкл/выкл</T>
          {lights.map((l, i) => (
            <NameRow key={l.entityId} icon={Lightbulb} tone={color.warm} device={l} onChange={(name) => setLights((cur) => cur.map((x, j) => (j === i ? { ...x, name } : x)))} />
          ))}
          <Glass kind="panel" radius={radius.card} style={{ overflow: 'hidden' }}>
            {lightEntities.map((e) => (
              <EntityRow key={e.entity_id} entity={e} selected={lights.some((l) => l.entityId === e.entity_id)} onPress={() => toggleLight(e)} />
            ))}
            {!lightEntities.length ? <T variant="caption" tone="tertiary" style={{ padding: 16 }}>Нет света и выключателей</T> : null}
          </Glass>
        </View>

        <View style={styles.column}>
          <T variant="overline" tone="secondary">Кондиционер</T>
          {climate ? <NameRow icon={Snowflake} tone={color.cool} device={climate} onChange={(name) => setClimate((c) => (c ? { ...c, name } : c))} /> : null}
          <Glass kind="panel" radius={radius.card} style={{ overflow: 'hidden' }}>
            {climateEntities.map((e) => {
              const selected = climate?.entityId === e.entity_id;
              return (
                <EntityRow key={e.entity_id} entity={e} selected={selected} radio onPress={() => { onTouch(); setClimate(selected ? null : { entityId: e.entity_id, name: 'Кондиционер' }); }} />
              );
            })}
            {!climateEntities.length ? <T variant="caption" tone="tertiary" style={{ padding: 16 }}>Нет климат-устройств</T> : null}
          </Glass>
        </View>
      </View>

      <Button title="Сохранить" icon={Save} variant="primary" size="lg" onPress={() => void save()} loading={saving} />
    </ScrollView>
  );
}

function NameRow({ icon, tone, device, onChange }: { icon: typeof Lightbulb; tone: string; device: SmartDevice; onChange: (name: string) => void }) {
  return (
    <Glass kind="accent" radius={22} style={[styles.selected, { backgroundColor: color.accentTint }]}>
      <Icon as={icon} size={22} tone={tone} />
      <TextInput value={device.name} onChangeText={onChange} maxLength={40} style={styles.nameInput} placeholder="Подпись для гостя" placeholderTextColor={color.textTertiary} />
      <T variant="small" tone="secondary" numberOfLines={1} style={{ maxWidth: '40%' }}>{device.entityId}</T>
    </Glass>
  );
}

function EntityRow({ entity, selected, onPress, radio }: { entity: HaEntity; selected: boolean; onPress: () => void; radio?: boolean }) {
  const mark = radio ? (selected ? CircleCheck : Circle) : selected ? SquareCheck : Square;
  return (
    <Press onPress={onPress} scaleTo={0.985} style={[styles.row, selected && { backgroundColor: 'rgba(139,92,246,0.10)' }]} accessibilityRole={radio ? 'radio' : 'checkbox'} accessibilityState={{ checked: selected }}>
      <Icon as={mark} size={24} tone={selected ? color.accentSoft : color.textTertiary} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="label" numberOfLines={1}>{friendly(entity)}</T>
        <T variant="small" tone="secondary" numberOfLines={1}>{entity.entity_id} · {entity.state}</T>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 20 },
  body: { paddingTop: 16, paddingBottom: GUTTER, gap: 20 },
  search: { height: 52, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, fontSize: 16, fontFamily: font.regular, color: color.text, paddingVertical: 0 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  column: { flexGrow: 1, flexBasis: 360, gap: 12 },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 },
  nameInput: { flex: 1, fontSize: 17, fontFamily: font.semibold, color: color.text, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
});
