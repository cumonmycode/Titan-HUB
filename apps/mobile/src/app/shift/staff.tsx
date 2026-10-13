import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';

import { WorkerPicker } from '@/components/staff/worker-picker';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { useShiftSummary } from '@/lib/queries';
import { useShiftSalary, useWorkers } from '@/lib/salary-api';
import { setShiftStaff } from '@/lib/shift-api';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Кто работает на текущей смене: отметить и «Готово». Получившего зарплату не снять. */
export default function ShiftStaffScreen() {
  const router = useRouter();
  const summary = useShiftSummary();
  const workers = useWorkers();
  const shift = summary.data?.shift ?? null;
  const salary = useShiftSalary(shift?.id);
  const current = (summary.data?.shift ? summary.data.staff : undefined) ?? [];
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = picked ?? current.map((w) => w.id);
  const locked = (salary.data?.workers ?? []).filter((w) => w.paid).map((w) => w.profileId);

  const save = async () => {
    if (!shift || busy) return;
    setBusy(true);
    try {
      await setShiftStaff(shift.id, selected);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Состав не сохранён', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Title>Кто на смене</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton variant="done" tintColor={colors.accent} disabled={!shift || busy} onPress={() => void save()}>
          {busy ? 'Сохраняем…' : 'Готово'}
        </ToolbarButton>
      </Stack.Toolbar>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        {workers.isLoading || summary.isLoading ? (
          <ActivityIndicator />
        ) : (
          <>
            <WorkerPicker
              workers={workers.data ?? []}
              selected={selected}
              locked={locked}
              onToggle={(id) => setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])}
            />
            <Text style={[type.footnote, styles.hint]}>Зарплату за смену получают только отмеченные сотрудники. Владелец в смену не входит.</Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg },
  hint: { color: colors.secondaryLabel },
});
