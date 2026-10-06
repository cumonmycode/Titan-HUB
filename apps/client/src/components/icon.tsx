// Иконки приложения: на iOS — системные SF Symbols (тот же рисунок и вес, что у таб-бара
// и шапки), на Android — Ionicons. Экраны называют иконку по смыслу («wallet», «bonus»),
// а пара символов для двух платформ живёт здесь, в одном реестре.
//
// Символы — не новее SF Symbols 4 (iOS 16): более новые на старых iPhone не рисуются.
import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { colors, IS_IOS } from '@/lib/theme';

type IonName = ComponentProps<typeof Ionicons>['name'];

const ICONS = {
  wallet: { sf: 'creditcard.fill', ion: 'wallet' },
  history: { sf: 'clock.arrow.circlepath', ion: 'time' },
  inbox: { sf: 'bell.fill', ion: 'notifications' },
  bell: { sf: 'bell', ion: 'notifications-outline' },
  profile: { sf: 'person.crop.circle.fill', ion: 'person-circle' },
  person: { sf: 'person.fill', ion: 'person' },
  pay: { sf: 'plus', ion: 'add' },
  bonus: { sf: 'star.fill', ion: 'star' },
  sparkles: { sf: 'sparkles', ion: 'sparkles' },
  flame: { sf: 'flame.fill', ion: 'flame' },
  deposit: { sf: 'arrow.down.circle.fill', ion: 'arrow-down-circle' },
  withdrawal: { sf: 'arrow.up.circle.fill', ion: 'arrow-up-circle' },
  refund: { sf: 'arrow.uturn.backward.circle.fill', ion: 'return-down-back' },
  receipt: { sf: 'doc.text.fill', ion: 'receipt' },
  debt: { sf: 'creditcard.fill', ion: 'card' },
  fund: { sf: 'person.2.fill', ion: 'people' },
  paid: { sf: 'checkmark.circle.fill', ion: 'checkmark-circle' },
  check: { sf: 'checkmark', ion: 'checkmark' },
  pending: { sf: 'hourglass', ion: 'hourglass' },
  trophy: { sf: 'trophy.fill', ion: 'trophy' },
  news: { sf: 'megaphone.fill', ion: 'megaphone' },
  alert: { sf: 'exclamationmark.circle.fill', ion: 'alert-circle' },
  close: { sf: 'xmark', ion: 'close' },
  chevron: { sf: 'chevron.right', ion: 'chevron-forward' },
  arrow: { sf: 'arrow.right', ion: 'arrow-forward' },
  external: { sf: 'arrow.up.right', ion: 'open-outline' },
  camera: { sf: 'camera.fill', ion: 'camera' },
  phone: { sf: 'phone.fill', ion: 'call' },
  birthday: { sf: 'gift.fill', ion: 'gift' },
  telegram: { sf: 'paperplane.fill', ion: 'paper-plane' },
  chat: { sf: 'bubble.left.and.bubble.right.fill', ion: 'chatbubbles' },
  document: { sf: 'doc.text.fill', ion: 'document-text' },
  logout: { sf: 'rectangle.portrait.and.arrow.right', ion: 'log-out-outline' },
  demo: { sf: 'flask.fill', ion: 'flask' },
  offline: { sf: 'wifi.slash', ion: 'cloud-offline' },
  backspace: { sf: 'delete.left', ion: 'backspace-outline' },
  bolt: { sf: 'bolt.fill', ion: 'flash' },
  shield: { sf: 'checkmark.shield.fill', ion: 'shield-checkmark' },
  copy: { sf: 'doc.on.doc', ion: 'copy-outline' },
  money: { sf: 'banknote.fill', ion: 'cash' },
} as const satisfies Record<string, { sf: SFSymbol; ion: IonName }>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}

export function Icon({ name, size = 22, color = colors.text, weight = 'semibold', style }: IconProps) {
  const icon = ICONS[name];
  if (IS_IOS) {
    return (
      <SymbolView
        name={icon.sf}
        size={size}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
        style={[{ width: size, height: size }, style]}
      />
    );
  }
  return <Ionicons name={icon.ion} size={size} color={color} style={style as never} />;
}

/** SF-символ иконки — для нативных мест, которые принимают имя символа (таб-бар, шапка). */
export function sfSymbol(name: IconName): SFSymbol {
  return ICONS[name].sf;
}
