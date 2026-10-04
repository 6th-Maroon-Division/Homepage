#!/usr/bin/env python3
"""Package explicitly allowlisted bot handoff material; never include local secrets."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'docs/discord/bot-handoff'
output = root / 'artifacts/discord-bot-handoff-2026-10-04.zip'
entries = {}
sources = {}

def add(path, target=None):
    relative = path.relative_to(root).as_posix()
    name = target or relative
    entries[name] = path.read_bytes()
    sources[name] = relative

for name in ('README.md', 'AI_STARTER_PROMPT.md', 'ACCEPTANCE_CHECKLIST.md', 'bootstrap.env.example'):
    add(source / name, name)
for name in (
    'openapi.yaml',
    'docs/discord/README.md',
    'docs/discord/feature-specification.md',
    'docs/discord/web-configuration-and-integration.md',
    'docs/api/batches/discord-admin.md',
    'docs/api/batches/discord-admin.openapi.json',
    'docs/api/batches/events.md',
    'docs/api/batches/events.openapi.json',
):
    add(root / name)
references = [root / name for name in (
    'prisma/schema.prisma', 'lib/bot-events.ts', 'lib/bot-event-feed.ts',
    'lib/notification-preferences.ts', 'lib/permissions.ts', 'lib/api/signups.ts',
    'lib/api/user-profile.ts', 'lib/orbat-schedule.ts',
)]
for folder, pattern in (
    ('lib/api/discord', '*.ts'), ('lib/discord', '*.ts'),
    ('app/api/discord', '**/route.ts'),
    ('tests/api', 'discord-*.test.ts'),
    ('tests/api-integration', 'discord-*.test.ts'),
    ('tests/ui', 'discord-admin.spec.ts'),
):
    references.extend(sorted((root / folder).glob(pattern)))
for migration in sorted((root / 'prisma/migrations').glob('*discord*/migration.sql')):
    references.append(migration)
for path in references:
    add(path, 'website-reference/' + path.relative_to(root).as_posix())
manifest = {
    'snapshotDate': '2026-10-04',
    'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip(),
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'provenance': 'Working-tree snapshot including uncommitted changes; baseCommit is not the contract snapshot. Deployment is not established.',
    'files': [dict(path=name, source=sources[name], sha256=hashlib.sha256(data).hexdigest()) for name, data in sorted(entries.items())],
}
entries['MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, data in sorted(entries.items()):
        info = zipfile.ZipInfo(name, (2026, 10, 4, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, data)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert not any(name.endswith(('.env', 'discord-bot-design.md', 'api-missing-features.md')) for name in archive.namelist())
    for entry in manifest['files']:
        assert hashlib.sha256(archive.read(entry['path'])).hexdigest() == entry['sha256']
print(f'{output.relative_to(root)}: {len(entries)} files, {output.stat().st_size:,} bytes; archive and checksums verified')
