// Вид карты клуба на главной (шесть текстур, components/club-card/faces.tsx).
// Выбирается в «Профиль → Вид карты», хранится на телефоне.
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

export type CardStyle = 'titanium' | 'graphite' | 'gold' | 'aurora' | 'onyx' | 'carbon';

export const CARD_STYLES: { key: CardStyle; title: string; text: string }[] = [
  { key: 'titanium', title: 'Титан', text: 'Светлый шлифованный металл с гравировкой' },
  { key: 'graphite', title: 'Графит', text: 'Тёмный металл, по которому бежит блик' },
  { key: 'gold', title: 'Золото', text: 'Тёплый шлифованный металл' },
  { key: 'aurora', title: 'Аврора', text: 'Глубокий фиолетовый, перетекает при наклоне' },
  { key: 'onyx', title: 'Оникс', text: 'Чёрная карта с гильошем и голограммой' },
  { key: 'carbon', title: 'Карбон', text: 'Плетение карбона с мягким бликом' },
];

const KEY = 'card_style';
// Старые значения (metal/foil/pass) не подходят — показываем «Титан».
const isCardStyle = (v: string | null): v is CardStyle => CARD_STYLES.some((c) => c.key === v);

interface CardStyleState {
  style: CardStyle;
  setStyle: (style: CardStyle) => void;
  load: () => Promise<void>;
}

export const useCardStyle = create<CardStyleState>((set) => ({
  style: 'titanium',
  setStyle: (style) => {
    set({ style });
    void SecureStore.setItemAsync(KEY, style).catch(() => {});
  },
  load: async () => {
    const saved = await SecureStore.getItemAsync(KEY).catch(() => null);
    if (isCardStyle(saved)) set({ style: saved });
  },
}));
