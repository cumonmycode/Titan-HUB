import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { useHa } from '@/lib/home-assistant';
import {
  climateInfo,
  fmtTemp,
  HVAC_LABEL,
  HVAC_SHORT,
  HVAC_SYMBOL,
  HVAC_TONE,
  isClimateOn,
  isOn,
  isUnavailable,
  powerClimate,
  setHvacMode,
  setLight,
  setTemperature,
  turnOffZones,
} from '@/lib/home-control';
import { haptic } from '@/lib/haptics';
import { zoneSymbol, type Zone, type ZoneDevice } from '@/lib/smart-home-api';
import { colors, space, type } from '@/lib/theme';

import { ANDROID_ON, ANDROID_ON_LABEL, HomePressable, HomeRoundButton, HomeSurface, IS_IOS } from './home-surface';

/** Тёплая подкраска стекла горящей лампы (iOS). */
const WARM_TINT = 'rgba(255,204,0,0.34)';
const BULB_ON = '#FFD60A';
/** Тон режима, которого нет в таблице (строка: к ней дописываем прозрачность). */
const DEFAULT_TONE = '#8B5CF6';
const TILE_RADIUS = IS_IOS ? 22 : 32;
const TILE_HEIGHT = 64;
/** Пальцы остановились — одна команда температуры вместо пяти. */
const TEMP_DEBOUNCE_MS = 650;

/* ─────────────────────────────── Свет ─────────────────────────────── */

function LightTile({ device, width }: { device: ZoneDevice; width: number }) {
  const entity = useHa((s) => s.entities[device.entityId]);
  const status = useHa((s) => s.status);
  const on = isOn(entity);
  const unavailable = status === 'connected' && isUnavailable(entity);
  const label = !entity ? '—' : unavailable ? 'Недоступно' : on ? 'Вкл.' : 'Выкл.';
  const onAndroid = !IS_IOS && on;

  return (
    <HomePressable
      active={on}
      tint={WARM_TINT}
      radius={TILE_RADIUS}
      disabled={unavailable || !entity}
      onPress={() => {
        haptic.selection();
        void setLight(device.entityId, !on);
      }}
      accessibilityRole="switch"
      accessibilityLabel={device.name}
      accessibilityState={{ checked: on, disabled: unavailable || !entity }}
      style={[styles.light, { width }, (unavailable || !entity) && styles.dim]}>
      {IS_IOS ? (
        <View style={[styles.bulb, { backgroundColor: on ? BULB_ON : colors.fill }]}>
          <SymbolView name={on ? 'lightbulb.fill' : 'lightbulb'} size={18} weight="semibold" tintColor={on ? '#3A2C00' : colors.secondaryLabel} />
        </View>
      ) : (
        <SymbolView name={on ? 'lightbulb.fill' : 'lightbulb'} size={22} tintColor={onAndroid ? ANDROID_ON_LABEL : colors.secondaryLabel} />
      )}
      <View style={styles.lightText}>
        <Text style={[type.subhead, styles.name, onAndroid && styles.onLabel]} numberOfLines={2}>
          {device.name}
        </Text>
        <Text style={[type.caption1, styles.secondary, onAndroid && styles.onSecondary]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </HomePressable>
  );
}

/* ─────────────────────────────── Климат ─────────────────────────────── */

function ClimateCard({ device }: { device: ZoneDevice }) {
  const entity = useHa((s) => s.entities[device.entityId]);
  const status = useHa((s) => s.status);
  const info = climateInfo(entity);
  const on = isClimateOn(entity);
  const unavailable = status === 'connected' && isUnavailable(entity);
  const disabled = unavailable || !entity;
  const modeTone = HVAC_TONE[info.mode] ?? DEFAULT_TONE;
  const tone = on ? modeTone : colors.secondaryLabel;

  const [pending, setPending] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = pending ?? info.target;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const bump = (direction: 1 | -1) => {
    if (shown == null) return;
    haptic.selection();
    const next = Math.min(info.max, Math.max(info.min, Math.round((shown + direction * info.step) * 10) / 10));
    setPending(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void setTemperature(device.entityId, next).finally(() => setPending(null));
    }, TEMP_DEBOUNCE_MS);
  };

  const subtitle = !entity
    ? 'нет данных'
    : unavailable
      ? 'Недоступен'
      : [HVAC_LABEL[info.mode] ?? info.mode, info.current != null ? `сейчас ${fmtTemp(info.current)}°` : null].filter(Boolean).join(' · ');

  return (
    <HomeSurface radius={IS_IOS ? 26 : 28} style={[styles.climate, disabled && styles.dim]}>
      <View style={styles.climateHead}>
        <View style={[styles.modeIcon, { backgroundColor: on ? `${modeTone}33` : colors.fill }]}>
          <SymbolView name={on ? (HVAC_SYMBOL[info.mode] ?? 'snowflake') : 'thermometer.medium'} size={18} weight="semibold" tintColor={tone} />
        </View>
        <View style={styles.climateTitles}>
          <Text style={[type.subhead, styles.name]} numberOfLines={1}>
            {device.name}
          </Text>
          <Text style={[type.caption1, { color: on ? tone : colors.secondaryLabel }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <HomeRoundButton
          size={44}
          fill={on ? (IS_IOS ? colors.green : ANDROID_ON) : undefined}
          disabled={disabled}
          onPress={() => {
            haptic.medium();
            void powerClimate(device.entityId, !on);
          }}
          accessibilityRole="switch"
          accessibilityLabel={`${device.name}: питание`}
          accessibilityState={{ checked: on }}>
          <SymbolView name="power" size={18} weight="bold" tintColor={on ? '#FFFFFF' : colors.label} />
        </HomeRoundButton>
      </View>

      <View style={styles.tempRow}>
        <HomeRoundButton size={48} disabled={disabled || !on || shown == null || shown <= info.min} onPress={() => bump(-1)} accessibilityRole="button" accessibilityLabel="Холоднее">
          <SymbolView name="minus" size={18} weight="bold" tintColor={colors.label} />
        </HomeRoundButton>
        <View style={styles.tempValue} accessible accessibilityLabel={shown != null ? `Цель ${fmtTemp(shown)} градусов` : 'Температура неизвестна'}>
          <Text style={[styles.temp, type.amount, { color: on ? colors.label : colors.tertiaryLabel }]}>{shown != null ? fmtTemp(shown) : '—'}</Text>
          <Text style={[type.title3, { color: tone }]}>°</Text>
        </View>
        <HomeRoundButton size={48} disabled={disabled || !on || shown == null || shown >= info.max} onPress={() => bump(1)} accessibilityRole="button" accessibilityLabel="Теплее">
          <SymbolView name="plus" size={18} weight="bold" tintColor={colors.label} />
        </HomeRoundButton>
      </View>

      {info.modes.length > 1 && (
        <View style={styles.modes}>
          {info.modes.map((mode) => {
            const selected = on && info.mode === mode;
            const chipTone = HVAC_TONE[mode] ?? DEFAULT_TONE;
            return (
              <Pressable
                key={mode}
                disabled={disabled}
                onPress={() => {
                  haptic.selection();
                  // Режим у выключенного кондиционера — включить его в этом режиме.
                  void setHvacMode(device.entityId, mode);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={HVAC_LABEL[mode] ?? mode}
                android_ripple={{ color: 'rgba(127,127,127,0.2)', borderless: false }}
                style={[
                  styles.mode,
                  IS_IOS ? styles.modeIos : styles.modeAndroid,
                  selected && (IS_IOS ? { backgroundColor: `${chipTone}38` } : { backgroundColor: ANDROID_ON, borderColor: ANDROID_ON }),
                ]}>
                <SymbolView name={HVAC_SYMBOL[mode] ?? 'circle'} size={15} weight="semibold" tintColor={selected ? (IS_IOS ? chipTone : ANDROID_ON_LABEL) : colors.secondaryLabel} />
                <Text style={[styles.modeText, { color: selected ? (IS_IOS ? colors.label : ANDROID_ON_LABEL) : colors.secondaryLabel }]} numberOfLines={1}>
                  {HVAC_SHORT[mode] ?? mode}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </HomeSurface>
  );
}

/* ─────────────────────────────── Помещение ─────────────────────────────── */

/** Колонки плиток света по ширине шторки: телефон — 2, iPad и ландшафт — 3–4. */
export const lightColumns = (width: number) => (width >= 900 ? 4 : width >= 560 ? 3 : 2);

export function ZoneSection({ zone, width }: { zone: Zone; width: number }) {
  const entities = useHa((s) => s.entities);
  const anyOn = zone.lights.some((l) => isOn(entities[l.entityId])) || zone.climates.some((c) => isClimateOn(entities[c.entityId]));
  const columns = lightColumns(width);
  const tileWidth = Math.floor((width - space.sm * (columns - 1)) / columns);

  return (
    <View style={styles.zone}>
      <View style={styles.zoneHead}>
        <SymbolView name={zoneSymbol(zone.name)} size={15} weight="semibold" tintColor={colors.secondaryLabel} />
        <Text style={[type.headline, styles.name, styles.zoneName]} numberOfLines={1} accessibilityRole="header">
          {zone.name}
        </Text>
        {anyOn && (
          <Pressable
            hitSlop={8}
            onPress={() => {
              haptic.light();
              void turnOffZones([zone]);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Выключить всё: ${zone.name}`}
            style={({ pressed }) => [styles.zoneOff, pressed && styles.pressed]}>
            <SymbolView name="power" size={12} weight="bold" tintColor={colors.secondaryLabel} />
            <Text style={[type.footnote, styles.secondary]}>Выключить</Text>
          </Pressable>
        )}
      </View>
      {zone.lights.length > 0 && (
        <View style={styles.grid}>
          {zone.lights.map((light) => (
            <LightTile key={light.entityId} device={light} width={tileWidth} />
          ))}
        </View>
      )}
      {zone.climates.map((climate) => (
        <ClimateCard key={climate.entityId} device={climate} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.label, fontWeight: '600' },
  secondary: { color: colors.secondaryLabel },
  onLabel: { color: ANDROID_ON_LABEL },
  onSecondary: { color: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.55 },

  zone: { gap: space.sm },
  zoneHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, minHeight: 28 },
  zoneName: { flex: 1 },
  zoneOff: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  light: { minHeight: TILE_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: IS_IOS ? 12 : 18, paddingVertical: 10 },
  bulb: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lightText: { flex: 1, gap: 1 },

  climate: { padding: 14, gap: space.md },
  climateHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  climateTitles: { flex: 1, gap: 1 },
  tempRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  tempValue: { flexDirection: 'row', alignItems: 'flex-start' },
  temp: { fontSize: 44, lineHeight: 50 },
  // Режимы — один ряд сегментов (значок над подписью): пять-шесть режимов не переносятся.
  modes: { flexDirection: 'row', gap: 6 },
  mode: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 52, paddingHorizontal: 2, borderRadius: IS_IOS ? 14 : 18, overflow: 'hidden' },
  modeIos: { backgroundColor: colors.fill },
  modeAndroid: { borderWidth: 1, borderColor: colors.separator },
  modeText: { fontWeight: '600', fontSize: 11, lineHeight: 13 },
});
