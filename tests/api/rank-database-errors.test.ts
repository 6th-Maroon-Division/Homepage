import { expect, test, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { rankDatabaseError } from '@/lib/api/ranks';
import { discordRoleDatabaseError } from '@/lib/api/rank-discord-roles';
import { rankRequirementsDatabaseError } from '@/lib/api/rank-requirements';
import { userRankMutationError } from '@/lib/api/user-rank-mutations';
import { promotionVisibility } from '@/lib/api/promotions';
import { parseLegacyCsv } from '@/lib/api/legacy-csv';

test.each([rankDatabaseError, discordRoleDatabaseError, rankRequirementsDatabaseError, userRankMutationError])('unknown database errors propagate to the common internal-error handler %#', mapError => {
  const error = { code: 'P1001', message: 'Database unavailable' };
  expect(() => mapError(error)).toThrow(error);
});

test('promotion visibility remains restrictive without grants even for a non-superadmin bot principal', () => {
  const filter = promotionVisibility({ kind: 'bot', tokenId: 9, permissions: {} });
  expect(filter).toEqual({ user: { OR: [{ id: -1 }, { userPermissions: { none: { OR: [{ permission: { key: 'system:super_admin' }, value: { gt: 0 } }, { permission: { key: 'rank:manage_promotions' }, value: { gte: 0 } }] } } }] } });
});

test.each([undefined, '', ' '.repeat(3), 'x'.repeat(1_000_001), 'plain"quote', '"closed" "unexpected"', '"unterminated'])('malformed or oversized legacy CSV is rejected %#', input => {
  expect(() => parseLegacyCsv(input)).toThrow();
});
test('legacy CSV accepts CR, CRLF, quoted newlines, escaped quotes and blank rows without inventing data', () => {
  expect(parseLegacyCsv('\r\n,\nname,value\r"A, B","one" \r\n"Two\nLines","say ""yes"""\n')).toEqual([['name', 'value'], ['A, B', 'one'], ['Two\nLines', 'say "yes"']]);
  expect(parseLegacyCsv(',')).toEqual([]);
});

import { parseAttendanceMatrix } from '@/lib/api/legacy-attendance';
import { parseLegacyUsers } from '@/lib/api/legacy-users';
test.each([
 'YEAR: 1800\nRANK,NAME,2-Jan\nPvt,User,P',
 'YEAR: 2025\nRANK,PERSON,2-Jan\nPvt,User,P',
 'YEAR: 2025\nGRADE,NAME,2-Jan\nPvt,User,P',
 'YEAR: 2025\nRANK,NAME,Not-a-date\nPvt,User,P',
 'YEAR: 2025\nRANK,NAME,2-Dec,2-Jan,2-Dec,3-Jan\nPvt,User,P,P,P,P',
 'YEAR: 2025\nRANK,NAME,31-Feb\nPvt,User,P',
 'YEAR: 2025\nRANK,NAME,2-Jan,2-Jan\nPvt,User,P,P',
 'YEAR: 2025\nRANK,NAME,2-Jan\nPvt,User,?',
 'YEAR: 2025\nRANK,NAME,2-Jan\nPvt,User,LOA',
 `YEAR: 2025\nRANK,NAME,2-Jan\n${Array.from({ length: 5001 }, (_, i) => `Pvt,User ${i},P`).join('\n')}`,
])('attendance matrices reject malformed calendar/header/status and excessive cells %#', csv => expect(() => parseAttendanceMatrix(csv)).toThrow());

test('matrix ignores incomplete identity rows and missing date cells while retaining usable attendance', () => {
 const result = parseAttendanceMatrix('YEAR: 2025\nRANK,NAME,ID,2-Jan,9-Jan\n,Skip,1,P,P\nPvt,,2,P,P\nPvt,Valid,,NA\nPvt,Other,3,P,EO');
 expect(result).toMatchObject({ processedCells: 4, skippedCells: 2 });
 expect(result.records.map(row => [row.legacyName, row.legacyUserId, row.legacyStatus])).toEqual([['Pvt Valid', null, 'NA'], ['Pvt Other', '3', 'P']]);
});
const legacyHeader = 'ID,NAME,Rank,Date Joined,TIG Since Last Promo,TOTAL TIG,Old Data';
test.each([
 'ID,NAME\n1,User',
 `${legacyHeader}\n1,User,Pvt`,
 `${legacyHeader}\n,User,Pvt,,,,`,
 `${legacyHeader}\n1,User,Pvt,,,,\n1,Other,Pvt,,,,`,
 `${legacyHeader}\n1,User,Pvt,,-1,,`,
 `${legacyHeader}\n1,User,Pvt,,2147483648,,`,
 `${legacyHeader}\n${Array.from({ length: 1001 }, (_, i) => `${i},User,Pvt,,,,`).join('\n')}`,
])('legacy baseline CSV rejects broken headers rows counts and duplicates %#', csv => expect(() => parseLegacyUsers(csv)).toThrow());
test('empty historical count cells become zero and blank joining dates remain null', () => {
 expect(parseLegacyUsers(`${legacyHeader}\n1,User,Pvt,,,,`)).toEqual([{ legacyId: '1', discordUsername: 'User', rankName: 'Pvt', dateJoined: null, tigSinceLastPromo: 0, totalTig: 0, oldData: 0 }]);
});
