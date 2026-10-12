import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowUpRight, Images } from 'lucide-react'
import { getStory } from '@/lib/hub'
import { photo } from '@/lib/format'
import { CtaBand, Gallery, PageHead, Section, Stats } from '@/components/sections/blocks'

export const revalidate = 60
export const dynamicParams = true

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const story = await getStory(slug)
  if (!story) return {}
  return {
    title: story.title,
    description: story.body[0] ?? story.tagline,
    openGraph: story.coverUrl ? { images: [{ url: photo(story.coverUrl).src }] } : undefined,
  }
}

export default async function StoryPage({ params }: Params) {
  const { slug } = await params
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) notFound()
  const story = await getStory(slug)
  if (!story) notFound()
  return (
    <article className="story-page">
      <PageHead
        title={story.title}
        lead={story.tagline}
        photoUrl={story.coverUrl ?? undefined}
        actions={<>
          {story.galleryUrl && <a className="btn btn-primary" href={story.galleryUrl} target="_blank" rel="noopener noreferrer"><Images size={18} aria-hidden="true" /> Все фото</a>}
          {story.resultsUrl && <a className="btn btn-ghost" href={story.resultsUrl} target="_blank" rel="noopener noreferrer">Результаты <ArrowUpRight size={16} aria-hidden="true" /></a>}
        </>}
      />
      {story.stats.length > 0 && <Stats items={story.stats} />}
      {story.body.length > 0 && (
        <Section>
          <div className="prose">{story.body.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}</div>
        </Section>
      )}
      <Section title="Фото">
        <Gallery photos={story.photos.filter((p) => p !== story.coverUrl)} title={story.title} />
        {story.galleryUrl && <p className="sec-more"><a className="btn btn-ghost" href={story.galleryUrl} target="_blank" rel="noopener noreferrer"><Images size={18} aria-hidden="true" /> Открыть всю галерею</a></p>}
      </Section>
      <CtaBand title="Хотите так же?" text="Турнир, вечеринка или праздник под ключ — оставьте заявку." preset={{ kind: 'event', format: 'party' }} label="Заказать мероприятие" />
    </article>
  )
}
