import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Inputs currently have visual labels rather than associated HTML labels.
// Scope to the exact permission key so catalog order does not affect the test.
const permissionInput = (page: Page, key: string) => page.getByText(key, { exact: true }).locator('../..').getByRole('spinbutton');

async function openPermissions(page: Page, userId: number) {
  await page.goto(`/admin/users/${userId}`);
  await page.getByRole('button', { name: 'Permissions', exact: true }).click();
  await page.getByRole('button', { name: /^orbat \d+ • Show$/ }).click();
}

async function savePermissions(page: Page, userId: number) {
  const response = page.waitForResponse(r => r.url().endsWith(`/api/users/${userId}/permissions`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.getByText('Permissions updated', { exact: true })).toBeVisible();
}

test('permissions grant, modify and revoke persist after reload and create an audit trail', async ({ page, login, db }) => {
  const subject = await db.user.create({ data: { username: 'UI Permission Subject' } });
  const permission = await db.permission.findUniqueOrThrow({ where: { key: 'orbat:create' } });
  await login();
  for (const value of [15, 25, 0]) {
    await openPermissions(page, subject.id);
    await permissionInput(page, permission.key).fill(String(value));
    await savePermissions(page, subject.id);
    await openPermissions(page, subject.id);
    await expect(permissionInput(page, permission.key)).toHaveValue(String(value));
    const grant = await db.userPermission.findUnique({ where: { userId_permissionId: { userId: subject.id, permissionId: permission.id } } });
    expect(grant?.value ?? 0).toBe(value);
  }
  const actions = await db.permissionAuditLog.findMany({ where: { targetUserId: subject.id, permissionId: permission.id }, orderBy: { id: 'asc' } });
  expect(actions.map(entry => entry.action)).toEqual(['GRANT', 'MODIFY', 'REVOKE']);
});

test('permission templates create, edit, preview, apply and delete without losing applied grants', async ({ page, login, db }) => {
  const subject = await db.user.create({ data: { username: 'UI Template Permission Subject' } });
  const permission = await db.permission.findUniqueOrThrow({ where: { key: 'orbat:create' } });
  await login();
  await page.goto('/admin/users?tab=permissionTemplates');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const name = page.getByText('Template Name', { exact: true }).locator('..').getByRole('textbox');
  await name.fill('UI Operations Permission Template');
  await page.getByText('Description', { exact: true }).locator('..').getByRole('textbox').fill('Browser workflow permission baseline');
  await page.getByRole('button', { name: /^orbat \d+ • Show$/ }).click();
  await permissionInput(page, permission.key).fill('12');
  const created = page.waitForResponse(r => r.url().endsWith('/api/permissions/templates') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByText('Permission template saved', { exact: true })).toBeVisible();
  const template = await db.permissionTemplate.findUniqueOrThrow({ where: { name: 'UI Operations Permission Template' } });
  await expect(page.getByRole('combobox')).toHaveValue(String(template.id));
  await permissionInput(page, permission.key).fill('18');
  const updated = page.waitForResponse(r => r.url().endsWith(`/api/permissions/templates/${template.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await updated).ok()).toBeTruthy();
  await openPermissions(page, subject.id);
  await page.getByRole('combobox').selectOption(String(template.id));
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(permissionInput(page, permission.key)).toHaveValue('18');
  expect(await db.userPermission.count({ where: { userId: subject.id } })).toBe(0);
  await savePermissions(page, subject.id);
  await openPermissions(page, subject.id);
  await expect(permissionInput(page, permission.key)).toHaveValue('18');
  await page.getByRole('link', { name: 'Manage Templates', exact: true }).click();
  await page.getByRole('combobox').selectOption(String(template.id));
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  expect(await db.permissionTemplate.count({ where: { id: template.id } })).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  const removed = page.waitForResponse(r => r.url().endsWith(`/api/permissions/templates/${template.id}`) && r.request().method() === 'DELETE');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await removed).ok()).toBeTruthy();
  await expect(page.getByText('Permission template deleted', { exact: true })).toBeVisible();
  expect(await db.permissionTemplate.count({ where: { id: template.id } })).toBe(0);
  expect((await db.userPermission.findUniqueOrThrow({ where: { userId_permissionId: { userId: subject.id, permissionId: permission.id } } })).value).toBe(18);
});

test('admin cannot edit their own grants through the permission editor', async ({ page, login, seed }) => {
  await login();
  await openPermissions(page, seed.adminId);
  await expect(page.getByText('Read-only: self-permission changes are blocked.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(permissionInput(page, 'orbat:create')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeDisabled();
});

for (const route of ['/admin/users?tab=permissionTemplates', '/admin/messaging']) {
  test(`ordinary member cannot open restricted actions at ${route}`, async ({ page, login }) => {
    await login('member');
    await page.goto(route);
    await expect(page).toHaveURL(/\/orbats$/);
    await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Template Details', exact: true })).toHaveCount(0);
  });
}

test('inbox expands a message, persists read state, filters unread and marks all read', async ({ page, login, db, seed }) => {
  const notices: Array<{ title: string; body: string; recipients: Array<{ id: number }> }> = [];
  for (const suffix of ['First', 'Second']) {
    notices.push(await db.message.create({ data: { title: `UI Inbox ${suffix}`, body: `Full browser inbox message ${suffix}`, createdById: seed.adminId, recipients: { create: { userId: seed.memberId, audienceType: 'user', channel: 'web' } } }, include: { recipients: true } }));
  }
  const privateNotice = await db.message.create({ data: { title: 'UI Staff Only Inbox', body: 'Only staff can see this', recipients: { create: { userId: seed.adminId, audienceType: 'user', channel: 'web' } } } });
  await login('member');
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await expect(page.getByRole('heading', { name: privateNotice.title, exact: true })).toHaveCount(0);
  const read = page.waitForResponse(r => r.url().endsWith(`/api/users/me/messages/${notices[0].recipients[0].id}`) && r.request().method() === 'PATCH');
  await page.getByRole('heading', { name: notices[0].title, exact: true }).click();
  expect((await read).ok()).toBeTruthy();
  await expect(page.getByText(notices[0].body, { exact: true })).not.toHaveClass(/line-clamp-2/);
  expect((await db.messageRecipient.findUniqueOrThrow({ where: { id: notices[0].recipients[0].id } })).readAt).not.toBeNull();
  await page.reload();
  await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByRole('heading', { name: notices[0].title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: notices[1].title, exact: true })).toBeVisible();
  const allRead = page.waitForResponse(r => r.url().endsWith('/api/users/me/messages') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  expect((await allRead).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByText('No unread messages', { exact: true })).toBeVisible();
  expect(await db.messageRecipient.count({ where: { userId: seed.memberId, isRead: false } })).toBe(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByRole('heading', { name: notices[0].title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: notices[1].title, exact: true })).toBeVisible();
});

test('inbox action opens its operation and records the message as read', async ({ page, login, db, seed }) => {
  const message = await db.message.create({ data: { title: 'UI Inbox Operation Action', body: 'Open the operation briefing', type: 'orbat', actionUrl: `/orbats/${seed.orbatId}`, recipients: { create: { userId: seed.memberId, audienceType: 'user', channel: 'web' } } }, include: { recipients: true } });
  await login('member');
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Open inbox', exact: true }).click();
  await page.getByRole('heading', { name: message.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/orbats/${seed.orbatId}$`));
  await expect(page.getByRole('heading', { name: 'Browser Public Operation', exact: true })).toBeVisible();
  await expect.poll(async () => (await db.messageRecipient.findUniqueOrThrow({ where: { id: message.recipients[0].id } })).isRead).toBe(true);
});
