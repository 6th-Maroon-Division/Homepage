// Discord Changelog Bot
// Parses PR body for changelog entries and sends formatted message to Discord

// Use built-in fetch (Node.js 20+)
const githubHeaders = {};
if (process.env.GITHUB_TOKEN) {
  githubHeaders['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
}

// Regexes
const HeaderRegex = /^\s*(?::cl:|🆑) *([a-z0-9_\- ]+)?\s+/im; // :cl: or 🆑 [0] followed by optional author name [1]
const EntryRegex = /^ *[*-]? *(add|remove|tweak|fix): *([^\n\r]+)\r?$/img; // * or - followed by change type [0] and change message [1]
const CommentRegex = /<!--.*?-->/gs; // HTML comments

// Emoji for each type
const typeEmojis = {
  add: '➕',
  remove: '➖',
  tweak: '🔧',
  fix: '🐛'
};

// Main function
async function main() {
  try {
    console.log(`Processing PR #${process.env.PR_NUMBER}...`);
    
    // Get PR details using fetch
    const prResponse = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/pulls/${process.env.PR_NUMBER}`,
      { headers: githubHeaders }
    );
    
    if (!prResponse.ok) {
      throw new Error(`GitHub API error: ${prResponse.status} ${prResponse.statusText}`);
    }
    
    const prData = await prResponse.json();
    const { merged_at, body, user, html_url, title } = prData;

    // Remove comments from the body
    const commentlessBody = body.replace(CommentRegex, '');

    // Get author
    const headerMatch = HeaderRegex.exec(commentlessBody);
    if (!headerMatch) {
      console.log('No changelog entry found (:cl: or 🆑), skipping');
      return;
    }

    let author = headerMatch[1]?.trim();
    if (!author) {
      console.log('No author found in changelog header, using PR author');
      author = user.login;
    }

    // Get all changes from the body
    const entries = getChanges(commentlessBody);

    if (!entries || entries.length === 0) {
      console.log('No valid changelog entries found, skipping');
      return;
    }

    // Check if PR was merged
    if (!merged_at) {
      console.log('Pull request was not merged, skipping');
      return;
    }

    // Format the Discord message
    const discordMessage = formatDiscordMessage({
      author,
      entries,
      prNumber: process.env.PR_NUMBER,
      prUrl: html_url,
      prTitle: title,
      mergedAt: merged_at
    });

    // Send to Discord
    if (process.env.DISCORD_WEBHOOK_URL) {
      await sendToDiscord(discordMessage);
      console.log(`Changelog sent to Discord for PR #${process.env.PR_NUMBER}`);
    } else {
      console.log('DISCORD_WEBHOOK_URL not set, skipping Discord notification');
      console.log('Formatted message:');
      console.log(JSON.stringify(discordMessage, null, 2));
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get all changes from the PR body
function getChanges(body) {
  const matches = [];
  const entries = [];

  for (const match of body.matchAll(EntryRegex)) {
    matches.push([match[1], match[2]]);
  }

  if (!matches || matches.length === 0) {
    return null;
  }

  // Check change types and construct changelog entry
  matches.forEach((entry) => {
    const type = entry[0].toLowerCase();
    const message = entry[1].trim();

    if (['add', 'remove', 'tweak', 'fix'].includes(type)) {
      entries.push({
        type: type.charAt(0).toUpperCase() + type.slice(1), // Capitalize first letter
        message: message
      });
    }
  });

  return entries.length > 0 ? entries : null;
}

// Format the Discord message
function formatDiscordMessage({ author, entries, prNumber, prUrl, prTitle, mergedAt }) {
  const date = new Date(mergedAt).toISOString().split('T')[0];

  // Group entries by type
  const groupedEntries = {};
  entries.forEach(entry => {
    const type = entry.type.toLowerCase();
    if (!groupedEntries[type]) {
      groupedEntries[type] = [];
    }
    groupedEntries[type].push(entry.message);
  });

  // Build embed fields for each type
  const fields = [];
  
  ['add', 'remove', 'tweak', 'fix'].forEach(type => {
    if (groupedEntries[type] && groupedEntries[type].length > 0) {
      const typeName = type.charAt(0).toUpperCase() + type.slice(1);
      const emoji = typeEmojis[type] || '';
      const value = groupedEntries[type].map(msg => `• ${msg}`).join('\n');
      
      fields.push({
        name: `${emoji} ${typeName}`,
        value: value,
        inline: false
      });
    }
  });

  return {
    content: `**New changes from PR #${prNumber}**`,
    embeds: [
      {
        title: prTitle,
        url: prUrl,
        color: 0x2b2d31, // Discord dark theme color
        author: {
          name: `Changes by ${author}`,
          icon_url: `https://github.com/${author}.png`
        },
        fields: fields,
        footer: {
          text: `Merged on ${date}`
        }
      }
    ]
  };
}

// Send message to Discord webhook
async function sendToDiscord(message) {
  try {
    const response = await fetch(
      process.env.DISCORD_WEBHOOK_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      }
    );
    
    if (!response.ok) {
      const text = await response.text();
      console.error('Discord webhook error:', response.status, text);
      throw new Error(`Discord webhook returned ${response.status}`);
    }
    
    console.log('Message sent to Discord successfully');
  } catch (error) {
    console.error('Error sending to Discord:', error.message);
    throw error;
  }
}

// Run main
main();
