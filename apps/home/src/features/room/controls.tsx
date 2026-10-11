// Плитки «Свет и климат»: лампа (вкл/выкл) и кондиционер. Каждая подписана на
// своё устройство — изменение одного устройства перерисовывает только его плитку.
import { Lightbulb, Minus, Plus, Power, Snowflake, Thermometer } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorText } from '@/data/api';
import type { SmartDevice } from '@/data/types';
import { IconButton } from '@/ui/button';
import { SwitchKnob } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Press } from '@/ui/press';
import { Segmented } from '@/ui/segmented';
import { T } from '@/ui/text';
import { toast } from '@/ui/toast';
import { color, radius } from '@/ui/tokens';

import { type HaStatus, useHa } from './ha';
import {
  climateInfo, fanLabel, fmtTemp, HVAC_ICON, HVAC_LABEL, HVAC_SHORT, HVAC_TONE, isOn, isUnavailable, powerClimate,
  setFanMode, setHvacMode, setLight, setTemperature,
} from './room';

const fail = (e: unknown) => toast(errorText(e), 'error');

export const STATUS_TEXT: Record<HaStatus, { text: string; tone: string }> = {
  connected: { text: 'на связи', tone: color.green },
  connecting: { text: 'подключаемся…', tone: color.amber },
  offline: { text: 'нет связи — команды выполнятся, как только она вернётся', tone: color.amber },
  auth_failed: { text: 'нет доступа к Home Assistant', tone: color.red },
  idle: { text: 'не настроено', tone: color.textTertiary },
};

export function LightTile({ device, wide }: { device: SmartDevice; wide: boolean }) {
  const entity = useHa((s) => s.entities[device.entityId]);
  const on = isOn(entity);
  const unavailable = !!entity && isUnavailable(entity);
  return (
    <Press
      onPress={() => setLight(device.entityId, !on).catch(fail)}
      disabled={unavailable}
      scaleTo={0.95}
      accessibilityRole="switch"
      accessibilityLabel={device.name}
      accessibilityState={{ checked: on }}
      style={[styles.light, wide && { flexBasis: '100%' }, glassStyle(on ? 'warm' : 'control', radius.card)]}
    >
      <View style={styles.lightTop}>
        <View style={[styles.bulb, { backgroundColor: on ? 'rgba(255,214,150,0.30)' : 'rgba(255,255,255,0.08)' }]}>
          <Icon as={Lightbulb} size={24} tone={on ? '#FFD08A' : color.textSecondary} stroke={1.9} />
        </View>
        <SwitchKnob on={on} />
      </View>
      <View style={{ gap: 2 }}>
        <T variant="subheading" numberOfLines={1}>{device.name}</T>
        <T variant="caption" style={{ color: on ? 'rgba(255,236,210,0.9)' : color.textSecondary }}>
          {unavailable ? 'Недоступно' : on ? 'Включено' : 'Выключено'}
        </T>
      </View>
    </Press>
  );
}

export function ClimateCard({ device }: { device: SmartDevice }) {
  const entity = useHa((s) => s.entities[device.entityId]);
  const info = climateInfo(entity);
  const off = info.mode === 'off';
  const unavailable = !!entity && isUnavailable(entity);
  const tone = off || unavailable ? color.textSecondary : HVAC_TONE[info.mode] ?? color.accentSoft;
  const ModeIcon = off ? Thermometer : HVAC_ICON[info.mode] ?? Snowflake;

  // Температуру жмут несколько раз подряд — отправляем одно значение, когда пальцы остановились.
  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = pending ?? info.target;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const bump = (dir: 1 | -1) => {
    if (shown == null) return;
    const next = Math.min(info.max, Math.max(info.min, Math.round((shown + dir * info.step) * 10) / 10));
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setTemperature(device.entityId, next).catch(fail).finally(() => setPending(null));
    }, 650);
  };

  return (
    <Glass kind="cool" radius={30} style={[styles.climate, !off && { borderColor: `${tone}55` }]}>
      <View style={styles.climateHead}>
        <View style={[styles.climateIcon, { backgroundColor: off ? 'rgba(255,255,255,0.08)' : `${tone}29` }]}>
          <Icon as={ModeIcon} size={22} tone={tone} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="subheading" numberOfLines={1}>{device.name}</T>
          <T variant="caption" style={{ color: tone }} numberOfLines={1}>{unavailable ? 'Недоступен' : HVAC_LABEL[info.mode] ?? info.mode}</T>
        </View>
        <Press
          onPress={() => powerClimate(device.entityId, off).catch(fail)}
          disabled={unavailable}
          scaleTo={0.9}
          accessibilityRole="switch"
          accessibilityLabel={off ? 'Включить кондиционер' : 'Выключить кондиционер'}
          accessibilityState={{ checked: !off }}
          style={[styles.power, off ? glassStyle('control', radius.pill) : { borderRadius: radius.pill, borderWidth: 1, backgroundColor: color.greenTint, borderColor: 'rgba(52,211,153,0.45)' }]}
        >
          <Icon as={Power} size={22} tone={off ? color.text : color.green} stroke={2} />
        </Press>
      </View>

      <View style={styles.tempRow}>
        <IconButton icon={Minus} label="Холоднее" size={64} onPress={() => bump(-1)} disabled={unavailable || shown == null || shown <= info.min} />
        <View style={{ alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <T variant="display" numeric style={[styles.temp, off && { color: color.textSecondary }]}>{shown != null ? fmtTemp(shown) : '—'}</T>
            <T variant="title" style={{ color: tone, marginTop: 4 }}>°</T>
          </View>
          <T variant="small" tone="secondary" numeric>
            {info.current != null ? `в кабинке ${fmtTemp(info.current)}°` : 'цель'}
            {info.humidity != null ? ` · ${Math.round(info.humidity)} %` : ''}
          </T>
        </View>
        <IconButton icon={Plus} label="Теплее" size={64} onPress={() => bump(1)} disabled={unavailable || shown == null || shown >= info.max} />
      </View>

      {info.modes.length ? (
        <Segmented
          stacked
          height={60}
          disabled={unavailable}
          value={off ? null : info.mode}
          onChange={(mode) => setHvacMode(device.entityId, mode).catch(fail)}
          options={info.modes.map((m) => ({ key: m, label: HVAC_SHORT[m] ?? m, icon: HVAC_ICON[m], tone: HVAC_TONE[m] }))}
        />
      ) : null}

      {info.fanModes.length > 1 ? (
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">Обдув</T>
          <Segmented
            height={46}
            disabled={unavailable || off}
            value={info.fanMode}
            onChange={(fan) => setFanMode(device.entityId, fan).catch(fail)}
            options={info.fanModes.map((f) => ({ key: f, label: fanLabel(f) }))}
          />
        </View>
      ) : null}
    </Glass>
  );
}

const styles = StyleSheet.create({
  light: { flexGrow: 1, flexBasis: '45%', height: 124, padding: 16, justifyContent: 'space-between' },
  lightTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bulb: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  climate: { padding: 18, gap: 16 },
  climateHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  climateIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  power: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  tempRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  temp: { fontSize: 64, lineHeight: 70 },
});
