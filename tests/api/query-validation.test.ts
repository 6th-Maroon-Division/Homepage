import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), token: vi.fn(), audit: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, botToken: { findFirst: mocks.token, findUnique: mocks.query, update: vi.fn() }, apiAuditLog: { create: mocks.audit } } }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import * as tokens from '@/app/api/bot-tokens/route';
import * as token from '@/app/api/bot-tokens/[id]/route';
import * as radios from '@/app/api/radio-frequencies/route';
import * as radio from '@/app/api/radio-frequencies/[id]/route';
import * as ranks from '@/app/api/ranks/route';
import * as rank from '@/app/api/ranks/[id]/route';
import * as reorder from '@/app/api/ranks/reorder/route';
import * as rankRequirements from '@/app/api/ranks/[id]/requirements/route';
import * as mappings from '@/app/api/ranks/discord-roles/route';
import * as mapping from '@/app/api/ranks/[id]/discord-role/route';
import * as roles from '@/app/api/subslot-definitions/route';
import * as role from '@/app/api/subslot-definitions/[id]/route';
import * as categories from '@/app/api/training-categories/route';
import * as category from '@/app/api/training-categories/[id]/route';
import * as trainings from '@/app/api/trainings/route';
import * as training from '@/app/api/trainings/[id]/route';
import * as requirements from '@/app/api/trainings/[id]/requirements/route';
import * as trainingUsers from '@/app/api/training-users/route';
import * as audits from '@/app/api/audit-logs/route';
import * as preferences from '@/app/api/users/[id]/notification-preferences/route';
import * as leaves from '@/app/api/users/[id]/leave-of-absences/route';
import * as leave from '@/app/api/leave-of-absences/[id]/route';
import * as userRank from '@/app/api/users/[id]/rank/route';
import * as rankHistory from '@/app/api/users/[id]/rank-history/route';
import * as userStatus from '@/app/api/users/[id]/status/route';
import * as statuses from '@/app/api/users/status/route';
import * as userRanks from '@/app/api/users/ranks/route';
import { validateQueryParameters } from '@/lib/api/validation';
const endpoints = { audits, preferences, leaves, leave, userRank, rankHistory, userStatus, statuses, userRanks, tokens, token, radios, radio, ranks, rank, reorder, rankRequirements, mappings, mapping, roles, role, categories, category, trainings, training, requirements, trainingUsers };
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const methods = Object.entries(endpoints).flatMap(([route, module]) => Object.entries(module).map(([method, handler]) => ({ route, method, handler: handler as Handler })));
const req = (method: string, query: string, body?: unknown, bot = false) => new Request(`http://localhost/api/test${query}`, { method, headers: { ...(bot ? { authorization: 'Bearer token' } : {}) }, ...(body === undefined || method === 'GET' ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: '1' } }); mocks.user.mockResolvedValue({ id: 1, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 1 }] }); mocks.token.mockResolvedValue({ id: 9 }); });
it.each(methods)('$route $method rejects undeclared queries for sessions and bots', async ({ method, handler }) => {
 for (const bot of [false,true]) { const response = await handler(req(method, '?unexpected=1', {}, bot), ctx()); expect(response.status).toBe(400); expect((await response.json()).error.code).toBe('invalid_request'); }
 expect(mocks.query).not.toHaveBeenCalled();
});
it.each(methods)('$route $method rejects repeated query fields', async ({ route, method, handler }) => {
 const field = ['mapping','mappings'].includes(route) ? 'guildId' : 'limit'; const value = field === 'guildId' ? '123456789012345678' : '1';
 expect((await handler(req(method, `?${field}=${value}&${field}=${value}`, {}), ctx())).status).toBe(400);
});
it.each(['activeOnly','categoryId'])('training filter %s cannot be repeated', async field => { expect((await trainings.GET(req('GET', `?${field}=1&${field}=2`))).status).toBe(400); });
it('declared query fields remain valid without globally banning endpoint-specific filters', () => {
 expect(validateQueryParameters(req('GET','?limit=50&cursor=1&activeOnly=true&categoryId=2'), ['limit','cursor','activeOnly','categoryId'])).toBeNull();
 expect(validateQueryParameters(req('POST',''), [])).toBeNull();
});
it.each(['GET','PATCH','DELETE'] as const)('token %s rejects IDs outside Prisma Int32 before querying', async method => { expect((await token[method](req(method, '', {}),ctx('2147483648'))).status).toBe(400); expect(mocks.query).not.toHaveBeenCalled(); });
it.each([
 { name: 'rank reorder', call: () => reorder.PATCH(req('PATCH','',{ranks:[{id:'1',orderIndex:0}]})) },
 { name: 'role prerequisites', call: () => roles.POST(req('POST','',{name:'Role',requiredTrainingIds:['1']})) },
 { name: 'training category', call: () => trainings.POST(req('POST','',{name:'Training',categoryId:'1'})) },
 { name: 'training rank requirement', call: () => requirements.PATCH(req('PATCH','',{minimumRankId:'1'}),ctx()) },
 { name: 'training prerequisites', call: () => requirements.PATCH(req('PATCH','',{requiredTrainingIds:['1']}),ctx()) },
 { name: 'rank prerequisites', call: () => rankRequirements.PATCH(req('PATCH','',{requiredTrainingIds:['1']}),ctx()) },
 { name: 'category swap', call: () => category.PATCH(req('PATCH','',{swapWithCategoryId:'1'}),ctx()) },
])('$name rejects string IDs in JSON before querying', async ({ call }) => { expect((await call()).status).toBe(422); expect(mocks.query).not.toHaveBeenCalled(); });

it.each(['GET','PATCH'] as const)('notification preferences %s rejects IDs outside Int32', async method => { expect((await preferences[method](req(method, '', {}),ctx('2147483648'))).status).toBe(400); });
