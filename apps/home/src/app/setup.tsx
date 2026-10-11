// Настройка планшета сотрудником: клуб → кабинка → PIN. Если токен истёк, а клуб
// и кабинка известны, экран сразу просит PIN.
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ArrowLeft, ArrowLeftRight, ArrowRight, RefreshCw, Sofa, Store } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { api, errorText } from '@/data/api';
import { normalizeClubHost, type Space, useSession } from '@/data/session';
import { PinPad } from '@/features/staff/staff-ui';
import { verifyStaffPin } from '@/features/staff/staff';
import { forgetClubCompletely } from '@/lib/reset';
import { Background } from '@/ui/background';
import { Button } from '@/ui/button';
import { Loader } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Press } from '@/ui/press';
import { useScreen } from '@/ui/screen';
import { T } from '@/ui/text';
import { color, font, radius } from '@/ui/tokens';

type ClubContext = { club: { slug: string; name: string } | null; subscription?: { blocked?: boolean } | null };

export default function SetupScreen() {
  const club = useSession((s) => s.club);
  const savedSpace = useSession((s) => s.space);
  const step: 'club' | 'space' | 'pin' = !club ? 'club' : !savedSpace ? 'space' : 'pin';
  const { width, height } = useScreen();
  const landscape = width >= height;

  return (
    <View style={[styles.screen, landscape && { flexDirection: 'row' }]}>
      <Background />
      <View style={[styles.brand, landscape ? styles.brandSide : styles.brandTop]}>
        <Glass kind="control" radius={36} style={styles.logo}>
          <Image source={require('@/assets/images/splash-icon.png')} style={{ width: 84, height: 84 }} contentFit="contain" />
        </Glass>
        <T variant="title" style={{ fontSize: 38, lineHeight: 44, marginTop: 8 }}>Titan Home</T>
        <T variant="body" tone="secondary" style={{ textAlign: 'center', maxWidth: 320 }}>Меню, счёт и свет кабинки — на одном планшете</T>
        {club ? (
          <View style={[styles.clubPill, glassStyle('accent', radius.pill), { backgroundColor: color.accentTint }]}>
            <Icon as={Store} size={18} tone={color.accentSoft} />
            <T variant="label" tone="accent" numberOfLines={1}>{club.name}</T>
          </View>
        ) : null}
      </View>
      <View style={styles.content}>
        {step === 'club' ? <ClubStep /> : step === 'space' ? <SpaceStep /> : <PinStep space={savedSpace!} />}
      </View>
    </View>
  );
}

function ClubStep() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    const host = normalizeClubHost(value);
    if (!host) {
      setError('Введите адрес клуба, например kbr');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ctx = await api.get<ClubContext>('/club/context', { host, auth: false });
      if (ctx.club && ctx.subscription?.blocked) {
        setError('Подписка клуба приостановлена — обратитесь к владельцу');
        return;
      }
      await useSession.getState().setClub({ host, slug: ctx.club?.slug ?? null, name: ctx.club?.name ?? 'Titan' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.step}>
      <T variant="title">Подключение к клубу</T>
      <T variant="body" tone="secondary" style={styles.lead}>Адрес клуба в Titan HUB — так же, как при входе в кассу.</T>
      <View style={[styles.inputWrap, glassStyle('control', 22)]}>
        <TextInput
          value={value}
          onChangeText={(t) => { setValue(t); setError(null); }}
          placeholder="kbr"
          placeholderTextColor={color.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
          style={styles.input}
        />
        {value.includes('.') ? null : <T variant="heading" tone="tertiary">.titanpos.ru</T>}
      </View>
      {error ? <T variant="label" tone="red" style={{ marginTop: 8 }}>{error}</T> : null}
      <Button title="Подключить" iconRight={ArrowRight} variant="primary" size="lg" onPress={() => void connect()} loading={busy} disabled={!value.trim()} style={{ marginTop: 20 }} />
    </Animated.View>
  );
}

function SpaceStep() {
  const host = useSession((s) => s.club?.host ?? '');
  const spaces = useQuery({
    queryKey: [host, 'tablet-spaces'],
    queryFn: () =>
      api.get<{ spaces: Space[] }>('/auth/tablet-spaces', { auth: false })
        .then((r) => [...r.spaces].sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }))),
  });

  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.step, { flex: 1 }]}>
      <T variant="title">Где стоит планшет?</T>
      <T variant="body" tone="secondary" style={styles.lead}>Выберите кабинку — планшет будет показывать её счёт и управлять её светом.</T>
      {spaces.isLoading ? (
        <Loader />
      ) : spaces.isError ? (
        <View style={{ gap: 12, alignItems: 'flex-start' }}>
          <T variant="label" tone="red">{errorText(spaces.error)}</T>
          <Button title="Повторить" icon={RefreshCw} onPress={() => void spaces.refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.spaces} showsVerticalScrollIndicator={false}>
          {(spaces.data ?? []).map((sp) => (
            <Press key={sp.id} onPress={() => void useSession.getState().setSpace(sp)} accessibilityLabel={sp.name} style={[styles.spaceTile, glassStyle('control', radius.card)]}>
              <View style={styles.spaceIcon}>
                <Icon as={Sofa} size={28} tone={color.accentSoft} />
              </View>
              <T variant="subheading" numberOfLines={2}>{sp.name}</T>
            </Press>
          ))}
          {spaces.data?.length === 0 ? <T variant="body">В клубе нет активных пространств.</T> : null}
        </ScrollView>
      )}
      <Button title="Другой клуб" icon={ArrowLeftRight} variant="quiet" onPress={() => void forgetClubCompletely()} style={{ alignSelf: 'flex-start' }} />
    </Animated.View>
  );
}

function PinStep({ space: sp }: { space: Space }) {
  const host = useSession((s) => s.club?.host);
  const wasSignedIn = useSession((s) => !!s.staff);
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.step, { alignItems: 'center' }]}>
      <View style={[styles.spaceChip, glassStyle('accent', radius.pill)]}>
        <Icon as={Sofa} size={20} tone={color.onAccent} />
        <T variant="label" tone="onAccent">{sp.name}</T>
      </View>
      <T variant="title" style={{ textAlign: 'center' }}>PIN сотрудника</T>
      <T variant="body" tone="secondary" style={[styles.lead, { textAlign: 'center' }]}>
        {wasSignedIn ? 'Сессия планшета закончилась — подтвердите её своим PIN.' : 'Тот же PIN, что для входа в кассу.'}
      </T>
      <PinPad onSubmit={(pin) => verifyStaffPin(sp.id, pin, host)} />
      <Button title="Другая кабинка" icon={ArrowLeft} variant="quiet" onPress={() => void useSession.getState().setSpace(null)} style={{ marginTop: 12 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  brand: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  brandSide: { width: '38%', borderRightWidth: 1, borderRightColor: color.hairline },
  brandTop: { paddingTop: 56, paddingBottom: 20 },
  logo: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  clubPill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 16, height: 40, maxWidth: 340 },
  content: { flex: 1, justifyContent: 'center', padding: 32 },
  step: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 8 },
  lead: { marginBottom: 16 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', height: 68, paddingHorizontal: 20 },
  input: { flex: 1, fontSize: 24, fontFamily: font.semibold, color: color.text, paddingVertical: 0 },
  spaces: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingBottom: 20 },
  spaceTile: { width: 184, height: 156, padding: 16, justifyContent: 'space-between' },
  spaceIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: color.accentTint, alignItems: 'center', justifyContent: 'center' },
  spaceChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 40, marginBottom: 12 },
});
