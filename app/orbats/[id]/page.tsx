// app/orbats/[id]/page.tsx
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { getPublicOrbat } from '@/lib/api/public-orbat';
import { parsePositiveId } from '@/lib/api/validation';
import { notFound } from 'next/navigation';
import OrbatDetailClient from '../components/OrbatDetailClient';

interface OrbatPageProps {
  params: Promise<{ id: string }>;
}

const formatEventDate = (date: Date | null) => {
  if (!date) {
    return null;
  }

  return date.toLocaleDateString('en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
};

const formatPreviewTime = (date: Date | null) => {
  if (!date) {
    return null;
  }

  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  });
};

export async function generateMetadata({ params }: OrbatPageProps): Promise<Metadata> {
  const { id } = await params;
  const orbatId = parsePositiveId(id);

  if (!orbatId || orbatId > 2147483647) {
    return {
      title: 'ORBAT | Invalid Operation',
      description: 'The requested operation could not be found.',
    };
  }

  const orbat = await prisma.orbat.findUnique({
    where: { id: orbatId },
    select: {
      id: true,
      name: true,
      description: true,
      eventDate: true,
      startsAtUtc: true,
      endsAtUtc: true,
      bluforCountry: true,
      opforCountry: true,
      indepCountry: true,
    },
  });

  if (!orbat) {
    return {
      title: 'ORBAT | Operation Not Found',
      description: 'The requested operation could not be found.',
    };
  }

  const [squadCount, slotCount, signupCount] = await prisma.$transaction([
    prisma.squad.count({ where: { orbatId: orbat.id } }),
    prisma.slot.count({ where: { orbatId: orbat.id } }),
    prisma.signup.count({
      where: {
        slot: {
          orbatId: orbat.id,
        },
      },
    }),
  ]);

  const eventDateLabel = formatEventDate(orbat.eventDate);
  const previewStartTime = formatPreviewTime(orbat.startsAtUtc);
  const previewEndTime = formatPreviewTime(orbat.endsAtUtc);
  const timeRange = previewStartTime || previewEndTime
    ? ` ${previewStartTime || '??:??'}${previewEndTime ? `-${previewEndTime}` : ''}`
    : '';
  const eventPart = eventDateLabel ? ` | ${eventDateLabel}${timeRange}` : '';

  const factionCountries = [orbat.bluforCountry, orbat.opforCountry, orbat.indepCountry]
    .filter((value): value is string => Boolean(value))
    .slice(0, 3)
    .join(' vs ');
  const factionPart = factionCountries ? ` | ${factionCountries}` : '';

  const statsPart = `${squadCount} squads, ${slotCount} roles, ${signupCount} signups`;
  const description = `${orbat.description?.trim() || 'Operation briefing'}${eventPart} | ${statsPart}${factionPart}`;
  const title = `${orbat.name} | ORBAT`;
  const urlPath = `/orbats/${orbat.id}`;
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const pageUrl = `${baseUrl}${urlPath}`;
  const imageUrl = `${baseUrl}/orbats/${orbat.id}/opengraph-image`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      url: pageUrl,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${orbat.name} ORBAT preview`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function OrbatPage({ params }: OrbatPageProps) {
  const { id } = await params;
  const orbatId = parsePositiveId(id);
  if (!orbatId || orbatId > 2147483647) notFound();

  const orbat = await getPublicOrbat(orbatId);
  if (!orbat) notFound();

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <OrbatDetailClient orbat={orbat} />
      </div>
    </main>
  );
}
