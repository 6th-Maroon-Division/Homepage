import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = {
  width: 1200,
  height: 630,
};

const LOCAL_LOGO_PATH = `${process.cwd()}/public/6MD_logo.svg`;

interface OrbatImageProps {
  params: Promise<{ id: string }>;
}

const formatEventDate = (date: Date | null) => {
  if (!date) {
    return 'Date TBD';
  }

  return date.toLocaleDateString('en-GB', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
};

const getUkTimezoneAbbreviation = (date: Date | null) => {
  const referenceDate = date ?? new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).formatToParts(referenceDate);

  return parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
};

const getIntelColor = (field: string, value: string) => {
  switch (field) {
    case 'iedThreat':
      switch (value) {
        case 'None': return '#22c55e';
        case 'Low': return '#84cc16';
        case 'Medium': return '#f59e0b';
        case 'High': return '#ef4444';
        case 'Very High': return '#dc2626';
        default: return '#93c5fd';
      }
    case 'civilianRelationship':
      switch (value) {
        case 'Friendly': return '#22c55e';
        case 'Neutral': return '#f59e0b';
        case 'Hostile': return '#ef4444';
        default: return '#93c5fd';
      }
    case 'airspace':
      switch (value) {
        case 'Friendly': return '#22c55e';
        case 'Contested': return '#f59e0b';
        case 'Hostile': return '#ef4444';
        default: return '#93c5fd';
      }
    case 'rulesOfEngagement':
      switch (value) {
        case 'Hold Fire': return '#ef4444';
        case 'Return Fire': return '#f59e0b';
        case 'PID': return '#84cc16';
        case 'Weapons Free': return '#22c55e';
        default: return '#93c5fd';
      }
    default:
      return '#93c5fd';
  }
};

const getRelationshipColor = (relationship: string) => {
  switch (relationship) {
    case 'Friendly': return '#22c55e';
    case 'Neutral': return '#f59e0b';
    case 'Hostile': return '#ef4444';
    default: return '#94a3b8';
  }
};

const fallbackImage = (label: string) =>
  new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          padding: '48px',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 2, opacity: 0.85 }}>ORBAT</div>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, marginTop: 12 }}>{label}</div>
      </div>
    ),
    {
      ...size,
    }
  );

export default async function Image({ params }: OrbatImageProps) {
  const { id } = await params;
  const orbatId = Number(id);

  if (Number.isNaN(orbatId)) {
    return fallbackImage('Invalid Operation');
  }

  const orbat = await prisma.orbat.findUnique({
    where: { id: orbatId },
    select: {
      name: true,
      description: true,
      eventDate: true,
      startsAtUtc: true,
      endsAtUtc: true,
      startTime: true,
      endTime: true,
      bluforCountry: true,
      bluforRelationship: true,
      opforCountry: true,
      opforRelationship: true,
      indepCountry: true,
      indepRelationship: true,
      iedThreat: true,
      civilianRelationship: true,
      rulesOfEngagement: true,
      airspace: true,
      inGameTimezone: true,
      operationDay: true,
      squads: {
        orderBy: { orderIndex: 'asc' },
        select: {
          name: true,
          slots: {
            orderBy: { orderIndex: 'asc' },
            select: {
              maxSignups: true,
              squadRole: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!orbat) {
    return fallbackImage('Operation Not Found');
  }

  const eventDateLabel = formatEventDate(orbat.eventDate);
  const ukTimezone = getUkTimezoneAbbreviation(orbat.eventDate);
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const previewStartTime = orbat.startsAtUtc ? timeFormatter.format(orbat.startsAtUtc) : orbat.startTime;
  const previewEndTime = orbat.endsAtUtc ? timeFormatter.format(orbat.endsAtUtc) : orbat.endTime;

  const timeRange = previewStartTime || previewEndTime
    ? `${previewStartTime || '??:??'}-${previewEndTime || '??:??'} ${ukTimezone}`
    : 'Time TBD';

  const factionRows = [
    orbat.bluforCountry
      ? { label: 'BLUFOR Country', value: orbat.bluforCountry, borderColor: '#93c5fd', valueColor: '#f8fafc' }
      : null,
    orbat.bluforRelationship
      ? {
          label: 'BLUFOR Relationship',
          value: orbat.bluforRelationship,
          borderColor: getRelationshipColor(orbat.bluforRelationship),
          valueColor: getRelationshipColor(orbat.bluforRelationship),
        }
      : null,
    orbat.opforCountry
      ? { label: 'OPFOR Country', value: orbat.opforCountry, borderColor: '#93c5fd', valueColor: '#f8fafc' }
      : null,
    orbat.opforRelationship
      ? {
          label: 'OPFOR Relationship',
          value: orbat.opforRelationship,
          borderColor: getRelationshipColor(orbat.opforRelationship),
          valueColor: getRelationshipColor(orbat.opforRelationship),
        }
      : null,
    orbat.indepCountry
      ? { label: 'Independent Country', value: orbat.indepCountry, borderColor: '#93c5fd', valueColor: '#f8fafc' }
      : null,
    orbat.indepRelationship
      ? {
          label: 'Independent Relationship',
          value: orbat.indepRelationship,
          borderColor: getRelationshipColor(orbat.indepRelationship),
          valueColor: getRelationshipColor(orbat.indepRelationship),
        }
      : null,
  ].filter((row): row is { label: string; value: string; borderColor: string; valueColor: string } => Boolean(row));

  const intelRows = [
    orbat.iedThreat
      ? {
          label: 'IED/Trap/Mine Threat',
          value: orbat.iedThreat,
          borderColor: getIntelColor('iedThreat', orbat.iedThreat),
          valueColor: getIntelColor('iedThreat', orbat.iedThreat),
        }
      : null,
    orbat.civilianRelationship
      ? {
          label: 'Civilian Relationship',
          value: orbat.civilianRelationship,
          borderColor: getIntelColor('civilianRelationship', orbat.civilianRelationship),
          valueColor: getIntelColor('civilianRelationship', orbat.civilianRelationship),
        }
      : null,
    orbat.rulesOfEngagement
      ? {
          label: 'Rules of Engagement',
          value: orbat.rulesOfEngagement,
          borderColor: getIntelColor('rulesOfEngagement', orbat.rulesOfEngagement),
          valueColor: getIntelColor('rulesOfEngagement', orbat.rulesOfEngagement),
        }
      : null,
    orbat.airspace
      ? {
          label: 'Airspace',
          value: orbat.airspace,
          borderColor: getIntelColor('airspace', orbat.airspace),
          valueColor: getIntelColor('airspace', orbat.airspace),
        }
      : null,
    orbat.inGameTimezone
      ? { label: 'In Game Timezone', value: orbat.inGameTimezone, borderColor: '#93c5fd', valueColor: '#f8fafc' }
      : null,
    orbat.operationDay
      ? { label: 'Operation Day', value: orbat.operationDay, borderColor: '#93c5fd', valueColor: '#f8fafc' }
      : null,
  ].filter((row): row is { label: string; value: string; borderColor: string; valueColor: string } => Boolean(row));

  const squadPanels = orbat.squads.map((squad) => {
    const roles = squad.slots.map((slot) => {
      const roleName = slot.squadRole?.name || 'Unassigned';
      const slotAmount = slot.maxSignups ?? 1;
      return slotAmount > 1 ? `${roleName} x${slotAmount}` : roleName;
    });

    return {
      squadName: squad.name,
      roles,
    };
  });

  const cache = globalThis as typeof globalThis & { __orbatLogoDataUrl?: string | null };
  let logoDataUrl = cache.__orbatLogoDataUrl ?? null;

  if (cache.__orbatLogoDataUrl === undefined) {
    try {
      const svgBuffer = await readFile(LOCAL_LOGO_PATH);
      logoDataUrl = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
    } catch {
      logoDataUrl = null;
    }

    cache.__orbatLogoDataUrl = logoDataUrl;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(140deg, #0b1220 0%, #111827 45%, #1f2937 100%)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
          padding: '36px 42px',
          justifyContent: 'flex-start',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 22, height: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', fontSize: 20, letterSpacing: 2.4, color: '#93c5fd' }}>ORBAT BRIEFING</div>
            <div
              style={{
                display: 'flex',
                fontSize: 46,
                lineHeight: 1.1,
                fontWeight: 800,
                maxWidth: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {orbat.name}
            </div>
            <div style={{ display: 'flex', fontSize: 22, color: '#cbd5e1' }}>
              {eventDateLabel} | {timeRange}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 18,
                color: '#94a3b8',
                maxWidth: 720,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {orbat.description?.trim() || 'Operation briefing and assignment overview'}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignContent: 'flex-start', marginTop: 6 }}>
              {squadPanels.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    background: 'rgba(15, 23, 42, 0.72)',
                    border: '1px solid rgba(148, 163, 184, 0.25)',
                    borderRadius: 12,
                    padding: '16px 18px',
                    color: '#cbd5e1',
                    fontSize: 18,
                  }}
                >
                  No squad layout configured
                </div>
              ) : (
                squadPanels.map((panel) => (
                  <div
                    key={panel.squadName}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      width: '49%',
                      background: 'rgba(15, 23, 42, 0.74)',
                      border: '1px solid rgba(147, 197, 253, 0.28)',
                      borderRadius: 12,
                      padding: '9px 10px',
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        fontSize: 15,
                        color: '#93c5fd',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {panel.squadName}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {panel.roles.map((role, index) => (
                        <div
                          key={`${panel.squadName}-${index}-${role}`}
                          style={{
                            display: 'flex',
                            fontSize: 11,
                            color: '#e2e8f0',
                            background: 'rgba(30, 41, 59, 0.8)',
                            border: '1px solid rgba(148, 163, 184, 0.28)',
                            borderRadius: 999,
                            padding: '2px 6px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          }}
                        >
                          {role}
                        </div>
                      ))}
                    </div>

                  </div>
                ))
              )}
            </div>

          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 390,
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(15, 23, 42, 0.82)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                borderRadius: 14,
                padding: '12px 14px',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>Faction Relations</div>
              {factionRows.length === 0 ? (
                <div style={{ display: 'flex', fontSize: 16, color: '#cbd5e1' }}>No faction data set</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {factionRows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: `4px solid ${row.borderColor}`,
                        paddingLeft: 10,
                        paddingTop: 2,
                        paddingBottom: 2,
                        width: '48%',
                      }}
                    >
                      <div style={{ display: 'flex', fontSize: 11, color: '#94a3b8' }}>{row.label}</div>
                      <div style={{ display: 'flex', fontSize: 13, color: row.valueColor, fontWeight: 700 }}>{row.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(15, 23, 42, 0.82)',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                borderRadius: 14,
                padding: '12px 14px',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: '#f8fafc' }}>Extra Intel</div>
              {intelRows.length === 0 ? (
                <div style={{ display: 'flex', fontSize: 16, color: '#cbd5e1' }}>No extra intel set</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {intelRows.map((intel) => (
                    <div
                      key={intel.label}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: `4px solid ${intel.borderColor}`,
                        paddingLeft: 10,
                        paddingTop: 2,
                        paddingBottom: 2,
                        width: '48%',
                      }}
                    >
                      <div style={{ display: 'flex', fontSize: 11, color: '#94a3b8' }}>{intel.label}</div>
                      <div style={{ display: 'flex', fontSize: 13, color: intel.valueColor, fontWeight: 700 }}>{intel.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {logoDataUrl && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'flex-end',
                  flex: 1,
                  minHeight: 220,
                }}
              >
                <img
                  src={logoDataUrl}
                  alt="6MD logo"
                  style={{
                    display: 'flex',
                    width: '100%',
                    height: '100%',
                    maxHeight: 220,
                    objectFit: 'contain',
                    objectPosition: 'right bottom',
                    marginBottom: 7,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
