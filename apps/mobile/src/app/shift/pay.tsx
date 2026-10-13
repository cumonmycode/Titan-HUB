import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { SalaryPayForm } from '@/components/salary/pay-form';

/** Выдача зарплаты прямо при закрытии смены (только владелец). */
export default function ShiftPayScreen() {
  const { shiftId, profileId } = useLocalSearchParams<{ shiftId: string; profileId: string }>();
  const router = useRouter();
  return (
    <>
      <Stack.Title>Зарплата</Stack.Title>
      <SalaryPayForm shiftId={shiftId} profileId={profileId} onDone={() => router.back()} />
    </>
  );
}
