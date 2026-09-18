import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parse } from 'yaml';
import { stripHtmlComments } from '../../.github/scripts/changelog-text.mjs';

for (const [name, input, expected] of [
  ['plain descriptions', ':cl: Example\nfix: A change', ':cl: Example\nfix: A change'],
  ['multiline comments', 'before<!-- hidden\nfix: Hidden -->after', 'before\nafter'],
  ['alternative comment endings', 'before<!-- hidden --!>after', 'before\nafter'],
  ['mixed nested comment endings', 'before<!-- outer <!-- inner --!> hidden -->after', 'before\nafter'],
  ['alternative nested outer endings', 'before<!-- outer <!-- inner --> hidden --!>after', 'before\nafter'],
  ['adjacent comments', 'before<!-- one --><!-- two -->after', 'before\n\nafter'],
  ['nested comments', 'before<!-- outer <!-- inner -->\nfix: Hidden -->after', 'before\nafter'],
  ['unterminated comments', 'before<!--\nfix: Hidden', 'before\n'],
  ['reassembled comment markers', '<!<!-- hidden -->-->', '<!\n-->'],
  ['reassembled changelog entries', 'fi<!-- hidden -->x: Forged', 'fi\nx: Forged'],
  ['null descriptions', null, ''],
  ['missing descriptions', undefined, ''],
]) {
  test(`comment filter handles ${name}`, () => {
    const output = stripHtmlComments(input);
    assert.equal(output, expected);
    assert.equal(output.includes('<!--'), false);
    assert.equal(stripHtmlComments(output), output);
  });
}

function runChangelog(body, { merged = true, githubStatus = 200 } = {}) {
  const pr = { body, merged_at: merged ? '2026-09-18T12:00:00Z' : null, user: { login: 'test-author' }, html_url: 'https://github.com/example/test/pull/123', title: 'Test change' };
  // Replace fetch before loading the real entry point. Unexpected URLs fail;
  // neither GitHub nor Discord can receive a network request from these tests.
  const mock = `
    import assert from 'node:assert/strict';
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.github.com/repos/example/test/pulls/123') {
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        return new Response(JSON.stringify(${JSON.stringify(pr)}), { status: ${githubStatus} });
      }
      assert.equal(url, 'https://discord.invalid/test-webhook');
      assert.equal(options.method, 'POST');
      console.log('CAPTURE:' + options.body);
      return new Response(null, { status: 204 });
    };
  `;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(mock).toString('base64')}`, '.github/scripts/discord-changelog.mjs'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, GITHUB_TOKEN: 'test-token', GITHUB_REPOSITORY: 'example/test', PR_NUMBER: '123', DISCORD_WEBHOOK_URL: 'https://discord.invalid/test-webhook' },
  });
  assert.ifError(result.error);
  return { ...result, messages: result.stdout.split('\n').filter(line => line.startsWith('CAPTURE:')).map(line => JSON.parse(line.slice(8))) };
}

test('real script sends only visible entries and preserves grouping and author fallback', () => {
  const result = runChangelog('<!-- :cl: Hidden\nfix: Hidden -->\n:cl:\nadd: New feature\n<!-- outer <!-- inner -->\nremove: Hidden -->\nfix: Visible correction');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.messages.length, 1);
  const embed = result.messages[0].embeds[0];
  assert.equal(embed.author.name, 'Changes by test-author');
  assert.deepEqual(embed.fields.map(field => field.value), ['• New feature', '• Visible correction']);
  assert.equal(embed.footer.text, 'Merged on 2026-09-18');
});

test('real script preserves visible entries after alternative comment endings', () => {
  const result = runChangelog('<!-- :cl: Hidden\nfix: Hidden --!>\n:cl:\nfix: Visible correction');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0].embeds[0].fields.map(field => field.value), ['• Visible correction']);
});

test('real script does not send empty, commented, malformed or unmerged changelogs', () => {
  for (const [body, options] of [
    [null, {}],
    ['<!-- :cl: Hidden\nfix: Hidden -->', {}],
    [':cl: Example\nfi<!-- hidden -->x: Forged', {}],
    [':cl: Example\n<!-- fix: Hidden', {}],
    [':cl: Example\nfix: Visible', { merged: false }],
  ]) {
    const result = runChangelog(body, options);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.messages, []);
  }
});

test('real script fails closed when the GitHub request fails', () => {
  const result = runChangelog(':cl: Example\nfix: Visible', { githubStatus: 503 });
  assert.equal(result.status, 1);
  assert.deepEqual(result.messages, []);
  assert.match(result.stderr, /GitHub API error: 503/);
});

test('changelog workflow grants only the read permissions its checkout and PR fetch need', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/discord-changelog.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(workflow.jobs['send-changelog'].permissions, undefined);
  assert.equal(workflow.jobs['send-changelog'].if, 'github.event.pull_request.merged == true');
});
