import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { AppRefreshControl } from '@/components/refresh-control';
import { Appear, PressScale, glide } from '@/components/smm/motion';
import { BigButton, Card, ChipButton, ErrorBanner, ProgressBanner, SectionTitle } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { ApiError } from '@/lib/api';
import { promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { useClubKey } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { TONE_LOOK, dayLabel, knowledgeRequest, useSmmKnowledge, type SmmClubDate, type SmmKnowledge, type SmmKnowledgeDoc, type SmmZone } from '@/lib/smm-knowledge';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const fail = (title: string) => (error: unknown) => Alert.alert(title, error instanceof ApiError || error instanceof Error ? error.message : String(error));
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : null);
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const UPCOMING_SHOWN = 8;
const RULES_URL = 'https://gomafia.pro/%D0%9E%D1%84%D0%B8%D1%86%D0%B8%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B5%20%D0%BF%D1%80%D0%B0%D0%B2%D0%B8%D0%BB%D0%B0%20%D0%B8%D0%B3%D1%80%D1%8B%20%D0%9C%D0%B0%D1%84%D0%B8%D1%8F.pdf';

/**
 * «База знаний» — всё, что Tai знает о клубе и опирается на это в планах, текстах,
 * картинках и видео: портрет клуба (ваши слова + собранное Tai), интерьер по зонам,
 * что уже было в соцсетях, праздники и свои даты, справка по мафии.
 */
export default function SmmKnowledgeScreen() {
  const router = useRouter();
  const club = useClubKey();
  const gutter = usePageGutter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const query = useSmmKnowledge();
  const [pulling, setPulling] = useState(false);
  const data = query.data;

  const request = (method: 'post' | 'delete', path: string, body?: unknown, title = 'Не получилось') => knowledgeRequest(club, method, path, body).then(() => haptic.success()).catch(fail(title));

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, gutter]}
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
        query.error ? <Text style={[type.body, styles.secondary, styles.center]}>{`Не загрузилось. ${query.error.message}`}</Text> : <ActivityIndicator style={styles.loading} />
      ) : (
        <>
          <Appear index={0}>
            <Intro data={data} />
          </Appear>
          <Appear index={1}>
            <ClubCard
              doc={data.club}
              isOwner={isOwner}
              onEdit={() => router.push({ pathname: '/manage/smm/edit-text', params: { knowledge: 'club' } })}
              onRefresh={() => void request('post', '/smm/knowledge/club/refresh', undefined, 'Tai не начал')}
            />
          </Appear>
          <Appear index={2}>
            <Interior
              zones={data.zones}
              isOwner={isOwner}
              onOpen={(zone) => router.push({ pathname: '/manage/smm/zone', params: { id: zone.id } })}
              onAdd={() =>
                promptText('Новая зона', 'Например, «Бар» или «Терраса».', [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Добавить', onPress: (title?: string) => void (title?.trim() ? request('post', '/smm/zones', { title: title.trim() }, 'Зона не добавилась') : undefined) },
                ])
              }
            />
          </Appear>
          <Appear index={3}>
            <Socials doc={data.socials} posts={data.socials.posts} onRefresh={() => void request('post', '/smm/knowledge/socials/refresh', undefined, 'Tai не начал')} />
          </Appear>
          <Appear index={4}>
            <Dates
              data={data}
              onAdd={() => router.push('/manage/smm/date')}
              onRemove={(id, title) =>
                Alert.alert('Убрать дату?', title, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Убрать', style: 'destructive', onPress: () => void request('delete', `/smm/dates/${id}`) },
                ])
              }
            />
          </Appear>
          <Appear index={5}>
            <Mafia mafia={data.mafia} />
          </Appear>
          <Appear index={6}>
            <PressScale onPress={() => router.push('/manage/smm/memory')} style={styles.linkRow} accessibilityRole="button">
              <SymbolView name="brain.head.profile" size={20} tintColor={colors.purple} />
              <View style={styles.flex}>
                <Text style={[type.headline, styles.label]}>Правила и выводы Tai</Text>
                <Text style={[type.caption1, styles.secondary]}>Что вы просили запомнить и что Tai понял из цифр</Text>
              </View>
              <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />
            </PressScale>
          </Appear>
        </>
      )}
    </ScrollView>
  );
}

function Intro({ data }: { data: SmmKnowledge }) {
  const accent = useAccentHex();
  const photos = data.zones.reduce((n, z) => n + z.photos.length, 0);
  const posts = Object.values(data.socials.posts).reduce((n, v) => n + v, 0);
  return (
    <Card style={styles.intro}>
      <View style={[styles.introIcon, { backgroundColor: accent }]}>
        <SymbolView name="books.vertical.fill" size={22} tintColor="white" />
      </View>
      <View style={styles.flex}>
        <Text style={[type.headline, styles.label]}>Что Tai знает о клубе</Text>
        <Text style={[type.footnote, styles.secondary]}>{`Прочитал ${posts.toLocaleString('ru-RU')} постов · ${photos} фото интерьера · правила ФСМ и роли городской мафии. На этом он строит планы, тексты, картинки и видео.`}</Text>
      </View>
    </Card>
  );
}

/** Текст, который сворачивается до нескольких строк и раскрывается по нажатию. */
function Expandable({ text, lines = 6 }: { text: string; lines?: number }) {
  const accent = useAccentHex();
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > lines || text.length > lines * 70;
  return (
    <Animated.View layout={glide} style={styles.expand}>
      <Text style={[type.subhead, styles.label]} numberOfLines={open ? undefined : lines} selectable>
        {text}
      </Text>
      {long ? (
        <PressScale onPress={() => setOpen((v) => !v)} scaleTo={0.96} hitSlop={8} accessibilityRole="button">
          <Text style={[type.subhead, { color: accent }]}>{open ? 'Свернуть' : 'Читать полностью'}</Text>
        </PressScale>
      ) : null}
    </Animated.View>
  );
}

function DocState({ doc }: { doc: SmmKnowledgeDoc }) {
  if (doc.progress) return <ProgressBanner progress={doc.progress} />;
  return doc.error ? <ErrorBanner text={doc.error} /> : null;
}

function ClubCard({ doc, isOwner, onEdit, onRefresh }: { doc: SmmKnowledgeDoc; isOwner: boolean; onEdit: () => void; onRefresh: () => void }) {
  return (
    <>
      <SectionTitle title="Портрет клуба" />
      <DocState doc={doc} />
      <Card>
        {doc.ownerText ? (
          <View style={styles.owner}>
            <Text style={[type.caption1, styles.secondary]}>ВАШИМИ СЛОВАМИ — ГЛАВНОЕ ДЛЯ TAI</Text>
            <Expandable text={doc.ownerText} lines={4} />
          </View>
        ) : null}
        {doc.aiText ? (
          <>
            <Text style={[type.caption1, styles.secondary]}>{`TAI СОБРАЛ ИЗ САЙТА, GOMAFIA И СОЦСЕТЕЙ${doc.aiAt ? ` · ${shortDate(doc.aiAt)?.toUpperCase()}` : ''}`}</Text>
            <Expandable text={doc.aiText} />
          </>
        ) : (
          <Text style={[type.subhead, styles.secondary]}>Tai соберёт портрет клуба из сайта, карточки на GoMafia и ваших соцсетей — кто вы, форматы, турниры и традиции, лица клуба.</Text>
        )}
        <View style={styles.row}>
          {isOwner ? <ChipButton title={doc.ownerText ? 'Изменить свои слова' : 'Рассказать о клубе'} icon="pencil" onPress={onEdit} /> : null}
          <ChipButton title={doc.aiText ? 'Обновить' : 'Собрать'} icon="arrow.clockwise" disabled={!!doc.progress} onPress={onRefresh} />
        </View>
      </Card>
    </>
  );
}

function Interior({ zones, isOwner, onOpen, onAdd }: { zones: SmmZone[]; isOwner: boolean; onOpen: (zone: SmmZone) => void; onAdd: () => void }) {
  return (
    <>
      <SectionTitle title="Интерьер клуба" action={isOwner ? 'Добавить' : undefined} onAction={isOwner ? onAdd : undefined} />
      <Text style={[type.footnote, styles.secondary]}>Фото каждой зоны с разных ракурсов. Когда сюжет у вас в клубе — Tai рисует картинку и видео именно в этом помещении.</Text>
      {zones.map((zone) => (
        <Animated.View key={zone.id} layout={glide}>
          <PressScale onPress={() => onOpen(zone)} style={styles.zone} accessibilityRole="button" accessibilityLabel={zone.title}>
            {zone.photos[0] ? (
              <Image source={{ uri: zone.photos[0].url }} style={styles.zoneThumb} contentFit="cover" transition={200} recyclingKey={zone.photos[0].id} />
            ) : (
              <View style={[styles.zoneThumb, styles.zoneEmpty]}>
                <SymbolView name="camera" size={20} tintColor={colors.tertiaryLabel} />
              </View>
            )}
            <View style={styles.flex}>
              <Text style={[type.headline, styles.label]} numberOfLines={1}>
                {zone.title}
              </Text>
              <Text style={[type.caption1, zone.photos.length ? styles.secondary : styles.warn]} numberOfLines={1}>
                {zone.progress ? 'Tai смотрит фото…' : [zone.photos.length ? `${zone.photos.length} фото` : 'Нет фото', zone.aiText ? 'описана Tai' : zone.ownerText ? 'есть описание' : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {zone.progress ? <ActivityIndicator /> : <SymbolView name="chevron.right" size={13} tintColor={colors.tertiaryLabel} />}
          </PressScale>
        </Animated.View>
      ))}
    </>
  );
}

function Socials({ doc, posts, onRefresh }: { doc: SmmKnowledgeDoc; posts: Record<string, number>; onRefresh: () => void }) {
  const counts = [posts['telegram'] ? `Telegram — ${posts['telegram']}` : null, posts['instagram'] ? `Instagram — ${posts['instagram']}` : null].filter(Boolean).join(', ');
  return (
    <>
      <SectionTitle title="Что было в соцсетях" />
      <DocState doc={doc} />
      <Card>
        <Text style={[type.footnote, styles.secondary]}>{counts ? `Прочитано постов: ${counts}.${doc.aiAt ? ` Разбор от ${shortDate(doc.aiAt)}.` : ''}` : 'Tai прочитает всю ленту канала и Instagram.'}</Text>
        {doc.aiText ? <Expandable text={doc.aiText} /> : <Text style={[type.subhead, styles.secondary]}>Как вы пишете, какие рубрики и традиции, что заходило и что нет — чтобы продолжать в том же духе и не повторяться.</Text>}
        <ChipButton title={doc.aiText ? 'Изучить заново' : 'Изучить соцсети'} icon="sparkles" disabled={!!doc.progress} onPress={onRefresh} />
      </Card>
    </>
  );
}

function DateRow({ d, onRemove }: { d: SmmClubDate; onRemove?: () => void }) {
  const look = TONE_LOOK[d.tone];
  const [, m, day] = d.date.split('-').map(Number) as [number, number, number];
  return (
    <Animated.View entering={FadeIn.duration(180)} layout={glide} style={styles.date}>
      <View style={[styles.dateBadge, { backgroundColor: `${look.color}22` }]}>
        <Text style={[type.headline, { color: look.color }]}>{day}</Text>
        <Text style={[type.caption2, { color: look.color }]}>{MONTHS_SHORT[m - 1]}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={[type.subhead, styles.label, styles.bold]} numberOfLines={2}>
          {d.title}
        </Text>
        <Text style={[type.caption1, styles.secondary]} numberOfLines={2}>
          {`${d.own ? 'Своя дата · ' : ''}${look.label}${d.weight === 3 ? ' · обязательно пост' : ''} — ${d.note}`}
        </Text>
      </View>
      {onRemove ? (
        <PressScale onPress={onRemove} scaleTo={0.9} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Убрать дату «${d.title}»`}>
          <SymbolView name="xmark.circle.fill" size={20} tintColor={colors.tertiaryLabel} />
        </PressScale>
      ) : null}
    </Animated.View>
  );
}

function Dates({ data, onAdd, onRemove }: { data: SmmKnowledge; onAdd: () => void; onRemove: (id: string, title: string) => void }) {
  const days = data.dates.upcoming.filter((d) => !d.until).slice(0, UPCOMING_SHOWN);
  const seasons = data.dates.upcoming.filter((d) => d.until);
  const ownAhead = new Set(days.filter((d) => d.own).map((d) => d.id));
  const ownRest = data.dates.own.filter((d) => !ownAhead.has(d.id));
  return (
    <>
      <SectionTitle title="Праздники и даты" action="Своя дата" onAction={onAdd} />
      <Text style={[type.footnote, styles.secondary]}>На важные даты Tai сам ставит тематические посты, под продающие поводы готовит анонсы заранее, в траурные дни молчит.</Text>
      <Card style={styles.dates}>
        {days.map((d) => (
          <DateRow key={`${d.date}-${d.title}`} d={d} onRemove={d.own && d.id ? () => onRemove(d.id!, d.title) : undefined} />
        ))}
        {seasons.length ? <Text style={[type.caption1, styles.secondary]}>{`Сейчас и скоро: ${seasons.map((s) => s.title.toLowerCase()).join(', ')}.`}</Text> : null}
      </Card>
      {ownRest.length ? (
        <Card style={styles.dates}>
          <Text style={[type.caption1, styles.secondary]}>СВОИ ДАТЫ КЛУБА</Text>
          {ownRest.map((d) => (
            <View key={d.id} style={styles.ownRow}>
              <Text style={[type.subhead, styles.label, styles.flex]}>{`${d.title} — ${dayLabel(d.day)}`}</Text>
              <PressScale onPress={() => onRemove(d.id, d.title)} scaleTo={0.9} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Убрать дату «${d.title}»`}>
                <SymbolView name="xmark.circle.fill" size={20} tintColor={colors.tertiaryLabel} />
              </PressScale>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function Mafia({ mafia }: { mafia: SmmKnowledge['mafia'] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <SectionTitle title="Мафия: что знает Tai" />
      <Card style={styles.mafia}>
        {mafia.sections.map((s, i) => (
          <Animated.View key={s.title} layout={glide}>
            <PressScale onPress={() => setOpen((v) => (v === i ? null : i))} style={styles.mafiaHead} scaleTo={0.98} accessibilityRole="button" accessibilityState={{ expanded: open === i }}>
              <Text style={[type.headline, styles.label, styles.flex]}>{s.title}</Text>
              <SymbolView name={open === i ? 'chevron.up' : 'chevron.down'} size={13} tintColor={colors.tertiaryLabel} />
            </PressScale>
            {open === i ? (
              <Animated.View entering={FadeIn.duration(180)}>
                <Text style={[type.subhead, styles.label]} selectable>
                  {s.text}
                </Text>
              </Animated.View>
            ) : null}
          </Animated.View>
        ))}
        <Text style={[type.caption1, styles.secondary]}>{`Источник по спортивной мафии: ${mafia.source}. Правила вашей городской мафии расскажите в «Портрете клуба».`}</Text>
      </Card>
      <BigButton title="Открыть правила ФСМ" icon="doc.text" tone="plain" onPress={() => void Linking.openURL(RULES_URL)} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  warn: { color: colors.orange },
  bold: { fontWeight: '600' },
  center: { textAlign: 'center' },
  loading: { marginTop: space.xxl },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  intro: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  introIcon: { width: 44, height: 44, borderRadius: 13, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  owner: { gap: 4, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  expand: { gap: 6 },
  zone: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, paddingRight: space.md, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card },
  zoneThumb: { width: 56, height: 56, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.fill },
  zoneEmpty: { alignItems: 'center', justifyContent: 'center' },
  dates: { gap: space.md },
  date: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dateBadge: { width: 48, height: 48, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  ownRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mafia: { gap: space.sm },
  mafiaHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card, marginTop: space.sm },
});
