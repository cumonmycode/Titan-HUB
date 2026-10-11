// Вид карты клуба на главной: металл, голографическая фольга или пасс Wallet.
// Выбирается в «Профиль → Вид карты», хранится на телефоне.
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

export type CardStyle = 'metal' | 'foil' | 'pass';

export const CARD_STYLES: { key: CardStyle; title: string; text: string }[] = [
  { key: 'metal', title: 'Металл', text: 'Графитовый титан, по которому бежит блик' },
  { key: 'foil', title: 'Фольга', text: 'Переливается радугой при наклоне' },
  { key: 'pass', title: 'Пасс Wallet', text: 'Бонусы, депозит и визиты прямо на карте' },
];

const KEY = 'card_style';
const isCardStyle = (v: string | null): v is CardStyle => v === 'metal' || v === 'foil' || v === 'pass';

interface CardStyleState {
  style: CardStyle;
  setStyle: (style: CardStyle) => void;
  load: () => Promise<void>;
}

export const useCardStyle = create<CardStyleState>((set) => ({
  style: 'metal',
  setStyle: (style) => {
    set({ style });
    void SecureStore.setItemAsync(KEY, style).catch(() => {});
  },
  load: async () => {
    const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
    if (isCardStyle(saved)) set({ style: saved });
  },
}));
