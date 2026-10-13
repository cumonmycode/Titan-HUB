import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { SalaryPayForm } from '@/components/salary/pay-form';

/** Выдача зарплаты из раздела «Зарплата»: за смену или разовая (аванс, премия). */
export default function SalaryPayScreen() {
  const { shiftId, profileId } = useLocalSearchParams<{ shiftId?: string; profileId: string }>();
  const router = useRouter();
  return (
    <>
      <Stack.Title>Выдать зарплату</Stack.Title>
      <SalaryPayForm shiftId={shiftId || null} profileId={profileId} onDone={() => router.back()} />
    </>
  );
}
