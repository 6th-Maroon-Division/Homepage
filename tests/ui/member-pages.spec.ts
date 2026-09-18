import { test, expect } from './fixtures';

export const coveredPages = ['/', '/profile', '/settings', '/settings/rank-history', '/trainings', '/trainings/requests/[id]'] as const;

test('home redirects anonymous visitors to the public operations calendar', async ({ page, seed }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/orbats$/);
  await expect(page.getByText('Browser Public Operation', { exact: true }).first()).toBeVisible();
});

for (const route of ['/profile', '/settings', '/settings/rank-history', '/trainings', '/trainings/requests/1']) {
  test(`anonymous visitors cannot open ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/orbats$/);
    await expect(page.getByRole('heading', { name: 'Browser Member', exact: true })).toHaveCount(0);
  });
}

for (const route of ['/settings', '/settings/rank-history', '/trainings']) {
  test(`${route} opens the member profile through its supported redirect`, async ({ page, login }) => {
    await login('member');
    await page.goto(route);
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: 'Browser Member', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  });
}

test('profile tabs load attendance, rank history and notification preferences', async ({ page, login }) => {
  await login('member');
  await page.goto('/profile');
  await expect(page.getByText('Unranked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recent Attendance' })).toBeVisible();
  await page.getByRole('button', { name: 'Rank History', exact: true }).click();
  await expect(page.getByText('No rank history yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notification preferences', exact: true })).toBeVisible();
  const preference = page.getByRole('checkbox').first();
  await expect(preference).toBeVisible();
  const original = await preference.isChecked();
  await preference.setChecked(!original);
  const saved = page.waitForResponse(response => response.url().includes('/api/users/me/notification-preferences') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).toBeChecked({ checked: !original });
});

test('profile saves leave dates as UTC through the browser', async ({ page, login, seed, db }) => {
  await login('member');
  await page.goto('/profile');
  await page.getByRole('button', { name: 'LOA', exact: true }).click();
  await page.locator('input[type="date"]').nth(0).fill('2099-08-10');
  await page.locator('input[type="date"]').nth(1).fill('2099-08-20');
  await page.getByPlaceholder('Reason for your leave').fill('Browser member leave');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/users/me/leave-of-absences') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit LOA', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByText('Reason: Browser member leave', { exact: true })).toBeVisible();
  const leave = await db.leaveOfAbsence.findFirstOrThrow({ where: { userId: seed.memberId, reason: 'Browser member leave' } });
  expect(leave.startDate.toISOString()).toBe('2099-08-10T00:00:00.000Z');
  expect(leave.returnDate?.toISOString()).toBe('2099-08-20T00:00:00.000Z');
});

test('member requests training from profile and sends a persisted request message', async ({ page, login, seed, db }) => {
  const training = await db.training.create({ data: { name: 'Browser Member Navigation', description: 'Navigation training for the browser flow' } });
  await login('member');
  await page.goto('/profile?tab=trainings');
  await page.getByRole('button', { name: /^Available Trainings/ }).click();
  const card = page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: training.name, exact: true }) }).last();
  await card.getByRole('button', { name: 'Request Training', exact: true }).click();
  await page.getByPlaceholder('Why do you want this training? (optional)').fill('Practise navigation');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/training-requests') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Submit Request', exact: true }).click();
  expect((await saved).status()).toBe(201);
  const request = await db.trainingRequest.findFirstOrThrow({ where: { userId: seed.memberId, trainingId: training.id } });
  expect(request.requestMessage).toBe('Practise navigation');
  await expect(page).toHaveURL(new RegExp(`/trainings/requests/${request.id}$`));
  await expect(page.getByRole('heading', { name: training.name, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Ready for the next session');
  const sent = page.waitForResponse(response => response.url().endsWith(`/api/training-requests/${request.id}/messages`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByText('Ready for the next session', { exact: true })).toBeVisible();
  expect(await db.trainingRequestMessage.count({ where: { requestId: request.id, senderId: seed.memberId, body: 'Ready for the next session' } })).toBe(1);
  await page.reload();
  await expect(page.getByText('Ready for the next session', { exact: true })).toBeVisible();
});

test('member cannot open another member training request', async ({ page, login, seed, db }) => {
  const training = await db.training.create({ data: { name: 'Private browser training' } });
  const request = await db.trainingRequest.create({ data: { userId: seed.adminId, trainingId: training.id, requestMessage: 'Private staff request content' } });
  await login('member');
  await page.goto(`/trainings/requests/${request.id}`);
  await expect(page.getByRole('heading', { name: 'Unable to open request', exact: true })).toBeVisible();
  await expect(page.getByText('Private staff request content', { exact: true })).toHaveCount(0);
});

test('profile username action persists and survives reload', async ({ page, login, seed, db }) => {
  await login('member');
  try {
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Actions', exact: true }).click();
    await page.getByPlaceholder('Enter username').fill('Browser Renamed Member');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/users/me') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Save Username', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Browser Renamed Member', exact: true })).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: seed.memberId } })).username).toBe('Browser Renamed Member');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Browser Renamed Member', exact: true })).toBeVisible();
  } finally {
    await db.user.update({ where: { id: seed.memberId }, data: { username: 'Browser Member' } });
  }
});
