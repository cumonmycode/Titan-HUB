// Панель сотрудника: вход PIN-ом (5 касаний логотипа на экране гостя).
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import {
  Home, Info, Lock, LogOut, Pin, PinOff, Power, RefreshCw, RotateCw, Settings, ShieldCheck, ShieldOff, Sofa, Store, Tablet,
  UserCheck, Wifi, X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { useSession } from '@/data/session';
import { useSmartHome } from '@/data/smart-home';
import { kickHa, useHa } from '@/features/room/ha';
import { ActionRow, InfoRow, PinPad, Section, ToggleRow } from '@/features/staff/staff-ui';
import { useStaff, verifyStaffPin } from '@/features/staff/staff';
import { usePrefs } from '@/lib/prefs';
import { forgetClubCompletely } from '@/lib/reset';
import { Background } from '@/ui/background';
import { Button } from '@/ui/button';
import { ScreenHeader } from '@/ui/screen-header';
import { Segmented } from '@/ui/segmented';
import { T } from '@/ui/text';
import { color, GUTTER } from '@/ui/tokens';

import { Kiosk, type KioskStatus, type Orientation } from '../../../modules/titan-kiosk';

export default function StaffScreen() {
  const router = useRouter();
  const sp = useSession((s) => s.space);
  const unlocked = useStaff((s) => s.until > 0);

  const close = () => {
    useStaff.getState().lock();
    router.back();
  };

  return (
    <View style={styles.screen}>
      <Background />
      <ScreenHeader icon={X} label="Закрыть" onBack={close} title="Для сотрудника" caption={sp?.name} right={unlocked ? <Button title="Готово" onPress={close} /> : null} />
      {unlocked ? (
        <Panel />
      ) : (
        <View style={styles.gate}>
          <T variant="body" tone="secondary" style={{ marginBottom: 20 }}>Введите PIN — тот же, что для входа в кассу</T>
          <PinPad onSubmit={(pin) => verifyStaffPin(sp!.id, pin)} />
        </View>
      )}
    </View>
  );
}

const HA_STATUS: Record<string, { text: string; tone: string }> = {
  connected: { text: 'Подключено', tone: color.green },
  connecting: { text: 'Подключаемся…', tone: color.amber },
  offline: { text: 'Нет связи', tone: color.red },
  auth_failed: { text: 'Неверный токен', tone: color.red },
  idle: { text: 'Не настроено', tone: color.textTertiary },
};

function Panel() {
  const router = useRouter();
  const session = useSession();
  const staff = useStaff((s) => s.nickname);
  const touch = useStaff((s) => s.touch);
  const prefs = usePrefs();
  const smart = useSmartHome();
  const haStatus = useHa((s) => s.status);
  const [status, setStatus] = useState<KioskStatus>(() => Kiosk.getStatus());

  const act = async (fn: () => Promise<unknown>) => {
    touch();
    await fn();
    setStatus(Kiosk.getStatus());
  };
  const confirm = (title: string, message: string, ok: string, onOk: () => void) =>
    Alert.alert(title, message, [{ text: 'Отмена', style: 'cancel' }, { text: ok, style: 'destructive', onPress: onOk }]);
  const openSystem = (kind: 'settings' | 'wifi' | 'home') =>
    act(async () => {
      await Kiosk.stopLockTask();
      await Kiosk.openSettings(kind);
    });

  const lockLabel = status.lockTask === 'locked' ? 'Закреплён (киоск)' : status.lockTask === 'pinned' ? 'Закреплён' : 'Не закреплён';
  const ha = HA_STATUS[haStatus] ?? HA_STATUS.idle!;
  const room = smart.data?.room;
  const devices = room ? [...room.lights.map((l) => l.name), room.climate?.name].filter(Boolean).join(', ') : '';

  return (
    <ScrollView contentContainerStyle={styles.panel} onScrollBeginDrag={touch} showsVerticalScrollIndicator={false}>
      <View style={styles.columns}>
        <View style={styles.column}>
          <Section title="Планшет">
            <InfoRow icon={Store} label="Клуб" value={session.club?.name} />
            <ActionRow
              icon={Sofa}
              label={`Кабинка · ${session.space?.name ?? '—'}`}
              hint={devices ? `Устройства: ${devices}` : 'Перенести планшет или выбрать устройства кабинок'}
              onPress={() => { touch(); router.push('/staff/booths'); }}
            />
            <InfoRow icon={UserCheck} label="Подтвердил" value={staff ?? session.staff} />
            <InfoRow icon={Tablet} label="Устройство" value={`${status.model} · Android ${status.androidVersion}`} />
            <InfoRow icon={Info} label="Версия" value={`${Application.nativeApplicationVersion ?? '—'} (${Application.nativeBuildVersion ?? '—'})`} />
          </Section>

          <Section
            title="Режим киоска"
            footer={status.isDeviceOwner
              ? 'Titan Home — владелец устройства: экран закрепляется сам, «Домой» ведёт в киоск, шторка и экран блокировки отключены.'
              : 'Полный киоск без вопросов: один раз на сброшенном планшете выполните на компьютере\nadb shell dpm set-device-owner ru.titan.home/expo.modules.titankiosk.KioskAdminReceiver'}
          >
            <InfoRow icon={ShieldCheck} label="Владелец устройства" value={status.isDeviceOwner ? 'Да' : 'Нет'} tone={status.isDeviceOwner ? color.green : undefined} />
            <InfoRow icon={Lock} label="Экран" value={lockLabel} tone={status.lockTask !== 'none' ? color.green : color.amber} />
            <InfoRow icon={Home} label="Домашний экран" value={status.isDefaultHome ? 'Titan Home' : 'Другое приложение'} tone={status.isDefaultHome ? color.green : color.amber} />
            {status.lockTask === 'none' ? (
              <ActionRow icon={Pin} label="Закрепить экран" hint="Гость не выйдет из Titan Home" onPress={() => void act(async () => { await prefs.update({ lockTask: true }); await Kiosk.startLockTask(); })} />
            ) : (
              <ActionRow icon={PinOff} label="Открепить экран" hint="Например, чтобы обновить приложение" onPress={() => void act(async () => { await prefs.update({ lockTask: false }); await Kiosk.stopLockTask(); })} />
            )}
            {!status.isDefaultHome ? <ActionRow icon={Home} label="Сделать домашним экраном" hint="Выберите Titan Home в списке" onPress={() => void openSystem('home')} /> : null}
          </Section>

          <Section title="Ориентация экрана" footer="«Как планшет» — экран поворачивается вместе с планшетом. Альбомную или книжную фиксируйте, только если планшет так и стоит: иначе Android сузит экран полосой.">
            <View style={{ padding: 12 }}>
              <Segmented<Orientation>
                value={prefs.orientation}
                onChange={(o) => void act(async () => { await prefs.update({ orientation: o }); await Kiosk.setOrientation(o); })}
                options={[
                  { key: 'auto', label: 'Как планшет', icon: RotateCw },
                  { key: 'landscape', label: 'Альбомная', icon: Tablet },
                  { key: 'portrait', label: 'Книжная', icon: Tablet },
                ]}
              />
            </View>
          </Section>
        </View>

        <View style={styles.column}>
          <Section title="Свет и климат" footer="Адрес и токен Home Assistant вбиваются в Titan HUB: «Управление» → «Настройки» → «Интеграции». Связь держит фоновый сервис Android — и когда экран свёрнут, и после перезагрузки. Устройства каждой кабинки выбираются в «Кабинке».">
            <InfoRow icon={Power} label="Home Assistant" value={smart.data?.connection ? ha.text : 'Не подключён в Titan HUB'} tone={smart.data?.connection ? ha.tone : color.textTertiary} />
            {smart.data?.connection && haStatus !== 'connected' ? (
              <ActionRow icon={RefreshCw} label="Переподключить" hint="Не ждать следующей попытки" onPress={() => { touch(); kickHa(); }} />
            ) : null}
            <ToggleRow icon={Power} label="Выключать после счёта" hint="Когда счёт закрыт — погасить свет и выключить кондиционер" value={prefs.roomAutoOff} onChange={(v) => void act(() => prefs.update({ roomAutoOff: v }))} />
          </Section>

          <Section title="Обслуживание">
            <ActionRow icon={Wifi} label="Настройки Wi-Fi" onPress={() => void openSystem('wifi')} />
            <ActionRow icon={Settings} label="Настройки Android" hint="Экран открепится; вернуться — кнопкой «Домой»" onPress={() => void openSystem('settings')} />
            {status.isDeviceOwner ? (
              <ActionRow icon={RotateCw} label="Перезагрузить планшет" onPress={() => confirm('Перезагрузить планшет?', 'Titan Home откроется сам после включения.', 'Перезагрузить', () => void Kiosk.reboot())} />
            ) : null}
          </Section>

          <Section title="Сброс">
            <ActionRow icon={LogOut} label="Другой клуб" tone={color.amber} onPress={() => confirm('Отключить от клуба?', 'Планшет забудет клуб и кабинку.', 'Отключить', () => void forgetClubCompletely())} />
            {status.isDeviceOwner ? (
              <ActionRow
                icon={ShieldOff}
                label="Снять режим владельца устройства"
                hint="Планшет станет обычным; удалить Titan Home можно будет только после этого"
                tone={color.red}
                onPress={() => confirm('Снять режим киоска?', 'Закрепление, «Домой» и отключение шторки будут сняты.', 'Снять', () => void act(() => Kiosk.clearDeviceOwner()))}
              />
            ) : null}
          </Section>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 20 },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: GUTTER },
  panel: { paddingTop: 16, paddingBottom: GUTTER },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  column: { flexGrow: 1, flexBasis: 380, gap: 20 },
});
