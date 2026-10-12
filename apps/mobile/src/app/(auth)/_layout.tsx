import { Stack } from 'expo-router';

import { stackHeaderOptions } from '@/components/header-glass';
import { useSession } from '@/lib/session';

export default function AuthLayout() {
  const club = useSession((s) => s.club);

  return (
    <Stack screenOptions={stackHeaderOptions}>
      <Stack.Protected guard={!club}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!!club}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
