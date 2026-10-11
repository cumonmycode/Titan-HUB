// Общее для карты клуба и её видов (отдельно, чтобы виды и карта не импортировали друг друга).
import type { DerivedValue, SharedValue } from 'react-native-reanimated';

/** Пропорции банковской карты (85,6 × 54 мм), как карты в Wallet. */
export const CARD_RATIO = 1.586;

export interface ClubCardData {
  nickname: string;
  tierLabel: string;
  tierColor: string;
  bonus: number;
  bonusHidden: boolean;
  /** «120 сгорят через 3 дня». */
  expiring?: string | null;
  /** Для пасса Wallet: депозит и визиты на карте. */
  deposit?: number;
  visits?: number;
}

/** Что получает вид карты: данные и наклон (−1…1) с шириной для бликов. */
export interface FaceProps {
  data: ClubCardData;
  tx: DerivedValue<number>;
  ty: DerivedValue<number>;
  width: SharedValue<number>;
}
