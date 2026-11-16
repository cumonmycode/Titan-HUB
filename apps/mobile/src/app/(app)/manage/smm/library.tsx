import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/refresh-control';
import { EmptyNote, ErrorBanner, ProgressBanner, SectionTitle } from '@/components/smm/parts';
import { PhotoGrid } from '@/components/smm/photo-grid';
import { Text, TextInput } from '@/components/text';
import { ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import { ApiError } from '@/lib/api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { libraryRequest, msk, useSmmLibrary, useSmmLibrarySearch, type SmmAlbum } from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

const KIND_NOTE: Record<string, string> = { template: 'шаблоны сторис', logo: 'логотипы', brand: 'фирменный стиль' };

/**
 * Фотоархив клуба (папка Google Диска по ссылке). Tai ищет здесь фото по описаниям,
 * когда пишет посты: берёт как есть, правит или рисует новое по мотивам. Отсюда же
 * фото можно найти и добавить в публикацию руками (открыто из поста — `postId`).
 */
export default function SmmLibraryScreen() {
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const query = useSmmLibrary();
  const [pulling, setPulling] = useState(false);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const found = useSmmLibrarySearch(search);
  const data = query.data;

  const request = async (method: 'put' | 'delete' | 'post', path: string, body?: unknown) => {
    try {
      await libraryRequest(club, method, path, body);
      haptic.success();
    } catch (error) {
      Alert.alert('Не получилось', error instanceof ApiError ? error.message : String(error));
    }
  };
  const connect = () =>
    promptText(
      'Папка Google Диска',
      'В Google Диске: «Поделиться» → «Все, у кого есть ссылка» → «Читатель», затем «Копировать ссылку» и вставьте её сюда.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Подключить', onPress: (link?: string) => void (link?.trim() ? request('put', '/smm/library', { link: link.trim() }) : undefined) },
      ],
      'plain-text',
      '',
      'url',
    );
  const disconnect = () =>
    Alert.alert('Отключить архив?', 'Tai перестанет брать фото из архива. Описания сохранятся — при новом подключении он сразу всё вспомнит.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: () => void request('delete', '/smm/library') },
    ]);

  const openAlbum = (album: SmmAlbum) => router.push({ pathname: '/manage/smm/album', params: { id: album.id, title: album.title, postId: postId ?? '' } });

  return (
    <View style={styles.screen}>
      <Stack.Title>Фотоархив</Stack.Title>
      {isOwner && data?.connected ? (
        <Stack.Toolbar placement="right">
          <ToolbarMenu icon="ellipsis" accessibilityLabel="Ещё">
            <ToolbarMenuAction icon="arrow.clockwise" onPress={() => void request('post', '/smm/library/sync')}>
              Обновить архив
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="safari" onPress={() => data.state && void Linking.openURL(data.state.url)}>
              Открыть в Google Диске
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="link" onPress={connect}>
              Другая папка
            </ToolbarMenuAction>
            <ToolbarMenuAction icon="xmark.circle" destructive onPress={disconnect}>
              Отключить
            </ToolbarMenuAction>
          </ToolbarMenu>
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void query.refetch().finally(() => setPulling(false));
            }}
          />
        }>
        {!data ? (
          query.error ? <Text style={[type.body, styles.secondary]}>{query.error.message}</Text> : <ActivityIndicator style={styles.loading} />
        ) : !data.connected ? (
          <EmptyNote
            icon="photo.stack"
            title="Фотоархив не подключён"
            text="Папка Google Диска с фото турниров, вечеров и фотосессий. Tai не скачивает её целиком: знает, что на каждом фото, и берёт в пост только нужное — как есть, с правкой или как образец для новой картинки."
            action={isOwner ? 'Подключить папку' : undefined}
            onAction={connect}
          />
        ) : (
          <>
            {/* Поиск — первым и крупно: ради него сюда и заходят. Сводка архива — одной строкой под ним. */}
            <View style={styles.search}>
              <SymbolView name="magnifyingglass" size={16} tintColor={colors.tertiaryLabel} />
              <TextInput
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setSearch(text.trim())}
                returnKeyType="search"
                placeholder="Кубок, ведущий, смех, Хэллоуин…"
                placeholderTextColor={colors.tertiaryLabel}
                selectionColor={colors.accent}
                style={[type.body, styles.input]}
                accessibilityLabel="Поиск по описаниям фото"
              />
              {text ? (
                <Pressable
                  onPress={() => {
                    setText('');
                    setSearch('');
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Очистить">
                  <SymbolView name="xmark.circle.fill" size={16} tintColor={colors.tertiaryLabel} />
                </Pressable>
              ) : null}
            </View>
            <Text style={[type.footnote, styles.secondary, styles.summary]}>
              {postId
                ? 'Нажмите на фото — оно встанет в публикацию, обрезанное под формат.'
                : [
                    `${data.counts.files.toLocaleString('ru-RU')} фото`,
                    `описано ${data.counts.described.toLocaleString('ru-RU')}`,
                    data.state?.syncedAt ? `обновлён ${msk(data.state.syncedAt)?.date.slice(5).split('-').reverse().join('.')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </Text>
            {data.state?.progress ? <ProgressBanner progress={data.state.progress} /> : null}
            {data.state?.error ? <ErrorBanner text={data.state.error} /> : null}

            {search ? (
              <>
                <SectionTitle title={found.data ? `Нашлось: ${found.data.photos.length}` : 'Ищу…'} />
                {found.data?.photos.length ? <PhotoGrid photos={found.data.photos} postId={postId} /> : found.data ? <Text style={[type.subhead, styles.secondary]}>Ничего не нашлось — попробуйте другие слова.</Text> : <ActivityIndicator />}
              </>
            ) : (
              <>
                <SectionTitle title={`Альбомы · ${data.counts.albums}`} />
                {/* Обложки сеткой по два: по крупной обложке альбом узнаётся быстрее, чем по строке пути. */}
                <View style={styles.albums}>
                  {data.albums.map((album) => (
                    <Pressable key={album.id} onPress={() => openAlbum(album)} style={({ pressed }) => [styles.album, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${album.title || 'Без названия'}, ${album.files} фото`}>
                      {album.cover ? <Image source={{ uri: album.cover }} style={styles.cover} contentFit="cover" recyclingKey={album.id} /> : <View style={[styles.cover, styles.coverEmpty]}><SymbolView name="photo" size={22} tintColor={colors.tertiaryLabel} /></View>}
                      <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={1}>
                        {album.title || 'Без названия'}
                      </Text>
                      <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
                        {[`${album.files} фото`, KIND_NOTE[album.kind]].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  loading: { marginTop: space.xxl },
  pressed: { opacity: 0.7 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#34A853', alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: 24, borderCurve: 'continuous', backgroundColor: colors.card },
  input: { flex: 1, color: colors.label, minHeight: 48 },
  summary: { marginTop: -space.xs, paddingHorizontal: space.xs },
  bold: { fontWeight: '600' },
  albums: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  album: { width: '48.5%', gap: 4 },
  cover: { width: '100%', aspectRatio: 1.4, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.fill },
  coverEmpty: { alignItems: 'center', justifyContent: 'center' },
});
