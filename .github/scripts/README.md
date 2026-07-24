# Discord Changelog Bot

This script automatically sends changelog messages to Discord when PRs are merged.

## Setup

### 1. Create Discord Webhook

1. Go to your Discord server
2. Create a channel for changelogs (e.g., `#changelog`)
3. Go to Channel Settings → Integrations → Webhooks
4. Click "New Webhook"
5. Copy the Webhook URL

### 2. Add GitHub Secret

You only need to add **one secret** manually:

1. Go to your GitHub repository
2. Go to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name it `DISCORD_WEBHOOK_URL`
5. Paste the Discord webhook URL you copied
6. Click "Add secret"

**Note:** `GITHUB_TOKEN` is automatically provided by GitHub Actions and has all the permissions needed to read PR details.

### 3. Enable Workflow

The workflow will run automatically when PRs are merged. No additional setup needed.

## Usage

Add a changelog to your PR description using this format:

```markdown
:cl:
- add: Added new feature X
- fix: Fixed bug with Y
- tweak: Improved Z behavior
- remove: Removed old feature A
```

Or with an author name:

```markdown
:cl: YourUsername
- add: Added new feature X
- fix: Fixed bug with Y
```

The bot will:
- Parse the changelog entries
- Group them by type (Add, Remove, Tweak, Fix)
- Send a formatted message to Discord
- Include PR title, URL, author, and merge date

### Supported Types

- `add` - New features additions
- `remove` - Removed features
- `tweak` - Changes to existing features
- `fix` - Bug fixes

### Example Discord Message

The Discord message will look like:

```
**New changes from PR #123**

[Embed with PR title linking to PR]
Changes by: username

➕ Add
• Added new feature X
• Added new feature Y

🐛 Fix
• Fixed bug with Z

Merged on: 2024-01-15
```

## Testing

To test the script locally:

```bash
# Set environment variables
DISCORD_WEBHOOK_URL="your_webhook_url" \
GITHUB_TOKEN="your_github_token" \
GITHUB_REPOSITORY="owner/repo" \
PR_NUMBER=123 \
node .github/scripts/discord-changelog.mjs
```

## Files

- `.github/workflows/discord-changelog.yml` - GitHub Actions workflow
- `.github/scripts/discord-changelog.mjs` - Main script
