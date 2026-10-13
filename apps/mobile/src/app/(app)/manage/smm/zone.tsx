import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Appear, PressScale, Skeleton, glide } from '@/components/smm/motion';
import { BigButton, Card, ChipButton, ErrorBanner, ProgressBanner, SectionTitle } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { ApiError } from '@/lib/api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { knowledgeRequest, pickPhotos, uploadZonePhotos, useSmmKnowledge, type SmmZone } from '@/lib/smm-knowledge';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const COLUMNS = 3;
const GAP = 6;
const fail = (title: string) => (error: unknown) => Alert.alert(title, error instanceof ApiError || error instanceof Error ? error.message : String(error));

/**
 * Зона клуба (вход, коридор, кабинки, зал…): фото с разных ракурсов, ваше описание и
 * то, что Tai увидел на фото. По ним Tai рисует картинки и видео в этом помещении —
 * когда сюжет публикации у вас в клубе.
 */
export default function SmmZoneScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const zone = useSmmKnowledge().data?.zones.find((z) => z.id === id);
  if (!zone) {
    return (
      <View style={[styles.screen, styles.centerBox]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <ZoneView zone={zone} />;
}

function ZoneView({ zone }: { zone: SmmZone }) {
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const accent = useAccentHex();
  const { width } = useWindowDimensions();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const inner = Math.min(width - gutter.paddingLeft - gutter.paddingRight, 640);
  const tile = Math.floor((inner - GAP * (COLUMNS - 1)) / COLUMNS);

  const addPhotos = async () => {
    const assets = await pickPhotos('Фото зоны');
    if (!assets.length) return;
    setUploading({ done: 0, total: assets.length });
    try {
      await uploadZonePhotos(club, zone.id, assets, (done) => setUploading({ done, total: assets.length }));
      haptic.success();
    } catch (error) {
      fail('Фото не загрузилось')(error);
    } finally {
      setUploading(null);
    }
  };
  const removePhoto = (photoId: string) =>
    Alert.alert('Убрать фото?', 'Tai перестанет опираться на этот ракурс.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void knowledgeRequest(club, 'delete', `/smm/zones/${zone.id}/photos/${photoId}`).catch(fail('Не убралось')) },
    ]);
  const describe = () => void knowledgeRequest(club, 'post', `/smm/zones/${zone.id}/describe`).then(() => haptic.light()).catch(fail('Tai не начал'));
  const rename = () =>
    promptText(
      'Название зоны',
      undefined,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Сохранить', onPress: (title?: string) => void (title?.trim() ? knowledgeRequest(club, 'patch', `/smm/zones/${zone.id}`, { title: title.trim() }).catch(fail('Не сохранилось')) : undefined) },
      ],
      'plain-text',
      zone.title,
    );
  const remove = () =>
    Alert.alert(`Удалить зону «${zone.title}»?`, 'Фото и описание зоны уйдут из базы знаний.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void knowledgeRequest(club, 'delete', `/smm/zones/${zone.id}`).then(() => router.back()).catch(fail('Не удалилось')) },
    ]);
  const canDescribe = zone.photos.length > 0 || !!zone.ownerText.trim();

  return (
    <ScrollView style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]}>
      <Stack.Title>{zone.title}</Stack.Title>
      {isOwner ? (
        <Stack.Toolbar placement="right">
          <ToolbarMenu icon="ellipsis" accessibilityLabel="Ещё">
            <ToolbarMenuAction icon="pencil" onPress={rename}>
              Переименовать
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="trash" destructive onPress={remove}>
              Удалить зону
            </ToolbarMenuAction>
          </ToolbarMenu>
        </Stack.Toolbar>
      ) : null}

      <Text style={[type.footnote, styles.secondary]}>Снимите зону с 3–6 ракурсов: общий план от входа, с противоположной стороны, крупно — стол, бар, декор. Лучше вечером, при своём свете, без людей в кадре.</Text>

      <View style={styles.grid}>
        {zone.photos.map((photo, i) => (
          <Animated.View key={photo.id} entering={FadeIn.duration(200).delay(Math.min(i, 6) * 30)} exiting={FadeOut.duration(150)} layout={glide}>
            <PressScale onPress={() => removePhoto(photo.id)} scaleTo={0.95} accessibilityRole="button" accessibilityLabel={`Фото ${i + 1}, убрать`}>
              <Image source={{ uri: photo.url }} style={[styles.photo, { width: tile, height: tile }]} contentFit="cover" transition={200} recyclingKey={photo.id} />
            </PressScale>
          </Animated.View>
        ))}
        {uploading ? (
          <View style={{ width: tile, height: tile }}>
            <Skeleton style={StyleSheet.absoluteFill} />
            <View style={styles.tileCenter}>
              <Text style={[type.caption1, styles.secondary]}>{`${uploading.done} из ${uploading.total}`}</Text>
            </View>
          </View>
        ) : (
          <PressScale onPress={() => void addPhotos()} scaleTo={0.95} style={[styles.add, { width: tile, height: tile, borderColor: `${accent}66` }]} accessibilityRole="button" accessibilityLabel="Добавить фото">
            <SymbolView name="plus" size={24} tintColor={accent} />
            <Text style={[type.caption1, { color: accent }]}>Фото</Text>
          </PressScale>
        )}
      </View>

      <Appear index={1}>
        <SectionTitle title="Ваше описание" />
        <Card>
          <Text style={[type.subhead, zone.ownerText ? styles.label : styles.secondary]} selectable>
            {zone.ownerText || 'Для чего зона, сколько мест, что в ней стоит, какой свет — Tai допишет остальное по фото.'}
          </Text>
          <ChipButton title={zone.ownerText ? 'Изменить' : 'Описать'} icon="pencil" onPress={() => router.push({ pathname: '/manage/smm/edit-text', params: { zoneId: zone.id } })} />
        </Card>
      </Appear>

      <Appear index={2}>
        <SectionTitle title="Что видит Tai" />
        {zone.progress ? <ProgressBanner progress={zone.progress} /> : zone.error ? <ErrorBanner text={zone.error} /> : null}
        {zone.aiText ? (
          <Card>
            <Text style={[type.subhead, styles.label]} selectable>
              {zone.aiText}
            </Text>
          </Card>
        ) : (
          <Text style={[type.footnote, styles.secondary]}>Tai посмотрит фото и опишет помещение — планировку, свет, цвета, мебель и удачные ракурсы. По этому описанию сцены в клубе получаются похожими на настоящие.</Text>
        )}
        <BigButton title={zone.aiText ? 'Описать заново' : 'Tai, опиши зону'} icon="sparkles" disabled={!canDescribe || !!zone.progress} busy={!!zone.progress} onPress={describe} style={styles.describe} />
      </Appear>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  centerBox: { alignItems: 'center', justifyContent: 'center' },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  photo: { borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.fill },
  add: { borderRadius: 12, borderCurve: 'continuous', borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  tileCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  describe: { marginTop: space.sm },
});
