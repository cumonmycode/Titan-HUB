import { clearCached } from '@/data/cache';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { clearSmartHomeCache } from '@/data/smart-home';
import { disconnectHa } from '@/features/room/ha';
import { useVisit } from '@/features/visit/store';

/** Отвязать планшет от клуба: забыть клуб, кабинку, кэш, умный дом и разорвать связь с HA. */
export async function forgetClubCompletely() {
  disconnectHa();
  useVisit.getState().reset();
  await clearSmartHomeCache();
  await clearCached();
  queryClient.clear();
  await useSession.getState().forgetClub();
}
