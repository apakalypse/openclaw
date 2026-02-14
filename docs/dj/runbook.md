# DJ Profile Pack - Setup Runbook

Complete setup guide for the DJ assistant profile on Windows/WSL2 with Telegram and Notion integration.

## Prerequisites

- Windows 10/11 with WSL2
- Node.js v22+ (in WSL2 or Windows)
- pnpm (recommended) or npm
- Telegram account with bot created
- Notion account with integration created
- Google account (for Calendar/Gmail via gog)

## Part 1: OpenClaw Gateway Setup

### 1.1 Install OpenClaw

```bash
# In WSL2 or Windows terminal
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm build
```

### 1.2 Create Base Configuration

```bash
# Create config directory
mkdir -p ~/.openclaw

# Create initial config file
cat > ~/.openclaw/openclaw.json << 'EOF'
{
  "gateway": {
    "port": 18789
  }
}
EOF
```

### 1.3 Test Gateway Startup

```bash
# Start gateway to verify installation
pnpm openclaw gateway run --port 18789 --verbose

# In another terminal, check health
curl http://localhost:18789/health
```

## Part 2: Telegram Bot Setup

### 2.1 Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "My DJ Assistant")
4. Choose a username (e.g., "MyDJAssistantBot")
5. Save the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2.2 Configure Telegram in OpenClaw

```bash
# Store token securely
mkdir -p ~/.openclaw/credentials
echo "YOUR_BOT_TOKEN" > ~/.openclaw/credentials/telegram.token
chmod 600 ~/.openclaw/credentials/telegram.token
```

Update `~/.openclaw/openclaw.json`:

```json
{
  "gateway": {
    "port": 18789
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "tokenFile": "~/.openclaw/credentials/telegram.token",
      "dmPolicy": "pairing",
      "commands": true,
      "streamMode": "partial"
    }
  }
}
```

### 2.3 Get Your Telegram User ID

1. Message your bot on Telegram (just say "hi")
2. Check gateway logs for the pairing code request
3. Note your user ID from the logs (numeric, e.g., `123456789`)

### 2.4 Pair Your Account

Once you message the bot, you'll receive a pairing code. Approve it:

```bash
openclaw channels telegram allow 123456789
```

Or add to allowlist in config:

```json
{
  "channels": {
    "telegram": {
      "allowFrom": ["123456789"]
    }
  }
}
```

## Part 3: Notion Integration Setup

### 3.1 Create Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it (e.g., "DJ Assistant")
4. Select your workspace
5. Copy the Internal Integration Token (starts with `ntn_` or `secret_`)

### 3.2 Store Notion Credentials

```bash
mkdir -p ~/.config/notion
echo "ntn_YOUR_TOKEN_HERE" > ~/.config/notion/api_key
chmod 600 ~/.config/notion/api_key
```

### 3.3 Create Notion Databases

1. In Notion, create a new page for your DJ workspace
2. Create the databases per [notion-schema.md](./notion-schema.md):
   - Tasks
   - Projects
   - Meetings Prep
   - Podcast Pipeline
   - Research Radar
   - Work Notes (separate for WorkSafe mode)

3. **Share each database with your integration:**
   - Open database
   - Click "..." menu
   - Click "Connect to"
   - Select your integration

### 3.4 Get Database IDs

For each database:
1. Open it in Notion
2. Copy the URL (e.g., `https://notion.so/workspace/abc123def456?v=...`)
3. The ID is the 32-character string before `?v=`

### 3.5 Configure Notion Database IDs

Set as environment variables in `~/.bashrc` or `~/.zshrc`:

```bash
export NOTION_API_KEY=$(cat ~/.config/notion/api_key)
export DJ_NOTION_TASKS_DB="abc123..."
export DJ_NOTION_PROJECTS_DB="def456..."
export DJ_NOTION_MEETINGS_DB="ghi789..."
export DJ_NOTION_PODCAST_DB="jkl012..."
export DJ_NOTION_RESEARCH_DB="mno345..."
export DJ_NOTION_WORK_NOTES_DB="pqr678..."
```

Or add to OpenClaw config:

```json
{
  "skills": {
    "dj": {
      "notion": {
        "tasksDb": "abc123...",
        "projectsDb": "def456...",
        "meetingsDb": "ghi789...",
        "podcastDb": "jkl012...",
        "researchDb": "mno345...",
        "workNotesDb": "pqr678..."
      }
    }
  }
}
```

## Part 4: Google Calendar/Gmail Setup (gog)

### 4.1 Install gog CLI

```bash
# macOS/Linux with Homebrew
brew install steipete/tap/gogcli

# Or build from source
go install github.com/steipete/gogcli@latest
```

### 4.2 Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable APIs:
   - Gmail API
   - Google Calendar API
   - Google Drive API (optional)
4. Create OAuth 2.0 credentials:
   - Application type: Desktop app
   - Download the JSON file as `client_secret.json`

### 4.3 Authenticate gog

```bash
# Set up credentials
gog auth credentials /path/to/client_secret.json

# Add your Google account with required services
gog auth add your@gmail.com --services gmail,calendar

# Verify authentication
gog auth list
```

### 4.4 Set Default Account

```bash
export GOG_ACCOUNT=your@gmail.com
```

Or specify per-command:

```bash
gog calendar events primary --account your@gmail.com
```

## Part 4b: Work Busy Calendar Setup (Optional)

If you want DJ to respect your work calendar without exposing meeting details:

### 4b.1 Get Outlook ICS URL

1. Go to [outlook.office.com/calendar](https://outlook.office.com/calendar)
2. Click Settings → **View all Outlook settings**
3. Navigate to **Calendar** → **Shared calendars**
4. Under "Publish a calendar", select your calendar
5. Choose **Can view when I'm busy** (for maximum privacy)
6. Click **Publish** and copy the **ICS** link

### 4b.2 Subscribe in Google Calendar

1. Go to [calendar.google.com](https://calendar.google.com)
2. Find **Other calendars** → click **+** → **From URL**
3. Paste the Outlook ICS URL
4. Click **Add calendar**
5. Rename the calendar to **Work Busy (ICS)**
6. Note the **Calendar ID** from calendar settings

### 4b.3 Configure DJ

```bash
# Set the Work Busy calendar ID
openclaw config set dj.workBusyCalendarId "YOUR_CALENDAR_ID@group.calendar.google.com"

# Or add to ~/.openclaw/openclaw.json
```

```json
{
  "dj": {
    "workBusyCalendarId": "abc123xyz@group.calendar.google.com"
  }
}
```

### 4b.4 Verify Setup

```bash
# List calendars to verify subscription
gog calendar list

# Test the integration
/calendars
/agenda today
```

For detailed setup instructions, see [work-busy-ics.md](./work-busy-ics.md).

## Part 5: DJ Agent Configuration

### 5.1 Copy DJ Workspaces

The DJ workspaces are in the repo at `workspaces/dj-personal/` and `workspaces/dj-worksafe/`.

Copy to your OpenClaw workspace location:

```bash
# Create workspace directories
mkdir -p ~/.openclaw/workspaces/dj-personal
mkdir -p ~/.openclaw/workspaces/dj-worksafe

# Copy workspace files
cp -r /path/to/openclaw/workspaces/dj-personal/* ~/.openclaw/workspaces/dj-personal/
cp -r /path/to/openclaw/workspaces/dj-worksafe/* ~/.openclaw/workspaces/dj-worksafe/
```

### 5.2 Edit USER.md

Update `~/.openclaw/workspaces/dj-personal/USER.md` with your information:

```markdown
- **Name:** Your Name or DJ Alias
- **Timezone:** America/New_York
- **Primary Email:** your@gmail.com
- **Calendar ID:** your@gmail.com
```

### 5.3 Configure Agents

Update `~/.openclaw/openclaw.json` with agent configuration:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-5"
      },
      "userTimezone": "America/New_York"
    },
    "list": [
      {
        "id": "dj-personal",
        "default": true,
        "name": "Cue",
        "workspace": "~/.openclaw/workspaces/dj-personal",
        "model": {
          "primary": "anthropic/claude-opus-4-5"
        },
        "identity": {
          "name": "Cue",
          "emoji": "⚡"
        },
        "tools": {
          "browser": { "enabled": false }
        }
      },
      {
        "id": "dj-worksafe",
        "name": "Assistant",
        "workspace": "~/.openclaw/workspaces/dj-worksafe",
        "model": {
          "primary": "lmstudio/local-model"
        },
        "identity": {
          "name": "Assistant",
          "emoji": "⬜"
        },
        "tools": {
          "browser": { "enabled": false },
          "email": { "enabled": false }
        }
      }
    ]
  }
}
```

### 5.4 Copy DJ Skills

Skills are in the repo at `skills/dj-*/`. They'll be auto-discovered from the bundled skills directory.

To add them to your workspace skills:

```bash
mkdir -p ~/.openclaw/workspaces/dj-personal/skills
cp -r /path/to/openclaw/skills/dj-* ~/.openclaw/workspaces/dj-personal/skills/
```

## Part 6: WorkSafe Mode with LM Studio (Optional)

### 6.1 Install LM Studio

1. Download from [lmstudio.ai](https://lmstudio.ai/)
2. Install and launch
3. Download a model (e.g., Llama 3.1 8B or similar)
4. Start the local server (default: `http://localhost:1234`)

### 6.2 Configure LM Studio Provider

Add to `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "lmstudio": {
        "baseUrl": "http://localhost:1234/v1",
        "apiKey": "lm-studio"
      }
    }
  }
}
```

### 6.3 Verify LM Studio Connection

```bash
curl http://localhost:1234/v1/models
```

## Part 7: Cron Jobs Setup

### 7.1 Create Daily Brief Cron

```bash
openclaw cron create \
  --name "dj-daily-brief" \
  --description "Morning agenda and task summary" \
  --agent dj-personal \
  --schedule "0 8 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate my daily brief." \
  --deliver \
  --channel telegram \
  --to "YOUR_TELEGRAM_USER_ID"
```

### 7.2 Create Weekly Review Cron

```bash
openclaw cron create \
  --name "dj-weekly-review" \
  --description "Week recap and next week preview" \
  --agent dj-personal \
  --schedule "0 19 * * 0" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate my weekly review." \
  --deliver \
  --channel telegram \
  --to "YOUR_TELEGRAM_USER_ID"
```

### 7.3 Verify Cron Jobs

```bash
openclaw cron list
```

## Part 8: Final Verification

### 8.1 Start Gateway

```bash
cd /path/to/openclaw
pnpm openclaw gateway run --port 18789 --verbose
```

### 8.2 Test Commands

In Telegram, message your bot:

1. `/agenda` - Should show calendar events and tasks
2. `/capture Buy headphones by Friday` - Should create Notion task
3. `/mode` - Should show current mode and switch options

### 8.3 Run Doctor Check

```bash
openclaw doctor
```

This will verify:
- Channel connections
- API credentials
- Agent configuration
- Skill availability

## Troubleshooting

### After a Reboot

See [post-reboot-recovery.md](./post-reboot-recovery.md) for the full recovery checklist and prevention plan (systemd service, doctor script, config requirements).

### Telegram Bot Not Responding

1. Check gateway is running: `curl http://localhost:18789/health`
2. Verify token: `cat ~/.openclaw/credentials/telegram-bot-token.txt`
3. Check logs: `tail -f /tmp/openclaw/openclaw-*.log`
4. Ensure bot is not blocked by Telegram (message @BotFather `/mybots`)
5. Check for `CLAUDECODE` env var leak: `echo $CLAUDECODE` (should be empty)
6. Check for missing `gateway.auth.token`: `grep auth ~/.openclaw/openclaw.json`

### Notion API Errors

1. Verify API key: `echo $NOTION_API_KEY`
2. Check database is shared with integration
3. Verify database ID format (32 chars, no dashes needed)
4. Test manually:
   ```bash
   curl -H "Authorization: Bearer $NOTION_API_KEY" \
        -H "Notion-Version: 2025-09-03" \
        https://api.notion.com/v1/users/me
   ```

### gog Authentication Issues

1. Re-authenticate: `gog auth add your@gmail.com --services gmail,calendar`
2. Check token expiry: `gog auth list`
3. Verify scopes are correct

### LM Studio Not Connecting

1. Ensure LM Studio server is running
2. Check port: `curl http://localhost:1234/v1/models`
3. Verify model is loaded in LM Studio UI

## Windows-Specific Notes

### WSL2 Networking

If running Gateway in WSL2 and accessing from Windows:

```bash
# Find WSL2 IP
hostname -I

# Access Gateway from Windows
curl http://[WSL2_IP]:18789/health
```

### Path Differences

- WSL2 paths use `/home/username/`
- Windows paths use `C:\Users\username\`
- OpenClaw resolves `~` to appropriate home directory

### Git Bash for Claude Code CLI

If using Claude Code CLI backend, set git-bash path:

```bash
CLAUDE_CODE_GIT_BASH_PATH='C:\Users\<username>\Documents\Git\bin\bash.exe' \
  pnpm openclaw gateway run --port 18789 --verbose
```

## Part 9: M4 Features Setup (Web Operator, Research, Site)

### 9.1 Enable Browser for Web Operator

Update agent config to enable browser for normal/deep profiles:

```json
{
  "agents": {
    "list": [
      {
        "id": "dj-personal",
        "tools": {
          "browser": {
            "enabled": true,
            "profile": "dj-personal"
          }
        }
      }
    ]
  }
}
```

Note: Browser is automatically disabled in `cheap` profile by the Web Operator.

### 9.2 Configure Web Operator

Add web operator settings to `~/.openclaw/openclaw.json`:

```json
{
  "dj": {
    "webOperator": {
      "autoSubmitEnabled": true,
      "autoSubmitDailyCap": 3,
      "autoSubmitWorkflowCap": 1,
      "requireHttps": true,
      "writeNotionWebOpsLog": true
    }
  }
}
```

Or use environment variables:

```bash
export DJ_WEB_AUTOSUBMIT_ENABLED=true
export DJ_WEB_AUTOSUBMIT_DAILY_CAP=3
export DJ_WEB_AUTOSUBMIT_WORKFLOW_CAP=1
```

### 9.3 Configure Research Skill

Add Research Radar database to Notion (see [notion-schema.md](./notion-schema.md)).

Configure research settings:

```bash
export DJ_NOTION_RESEARCH_RADAR_DB="your-database-id"
export DJ_RESEARCH_AUTO_SAVE=false
export DJ_RESEARCH_CACHE_TTL_HOURS=24
```

### 9.4 Configure Squarespace Integration

For `/site` commands, add Squarespace settings:

```json
{
  "dj": {
    "squarespace": {
      "siteUrl": "https://yoursite.squarespace.com",
      "editorUrl": "https://yoursite.squarespace.com/config/pages",
      "defaultTemplate": "episode"
    }
  }
}
```

### 9.5 Test M4 Features

```bash
# Test budget profile
/budget

# Test research (cheap profile first)
/research "test query"

# Switch to normal for browser features
/budget normal

# Test web plan (dry-run, no side effects)
/web plan "Navigate to google.com"

# Test site draft (requires Squarespace login)
/site draft-post "Test Post"
```

### 9.6 Important M4 Notes

1. **Browser disabled in cheap profile** - Switch to normal or deep
2. **Cron never inherits deep mode** - Scheduled tasks use normal/cheap
3. **Publishing always requires approval** - `/site publish` is never auto-submitted
4. **Auto-submit caps persist** - State stored in `~/.openclaw/dj-web-autosubmit-state.json`
5. **Logs location** - `~/.openclaw/logs/dj-web-<date>.jsonl`

### 9.7 M4.5: Notion API Configuration

M4.5 enables real Notion API integration for audit logging, research persistence, and site content management.

#### Required: Notion API Key

Get your API key from https://www.notion.so/my-integrations:

```bash
export NOTION_API_KEY="secret_your_notion_api_key"
```

Or store in a file:
```bash
echo "secret_your_notion_api_key" > ~/.config/notion/api_key
```

#### Notion Database IDs

Configure database IDs for each feature:

```bash
# WebOps audit log (tracks all /web operations)
export DJ_NOTION_WEBOPS_DB_ID="your-webops-database-id"

# Research Radar (stores /research save results)
export DJ_NOTION_RESEARCH_RADAR_DB_ID="your-research-database-id"

# Posts database (tracks /site drafts and publishes)
export DJ_NOTION_POSTS_DB_ID="your-posts-database-id"
```

Or via JSON config:
```json
{
  "dj": {
    "notion": {
      "webOpsDbId": "your-webops-database-id",
      "researchRadarDbId": "your-research-database-id",
      "postsDbId": "your-posts-database-id"
    }
  }
}
```

#### Notion Database Schemas

**WebOps Log** (created automatically if using Notion template):
| Property | Type | Description |
|----------|------|-------------|
| Name | Title | Workflow ID |
| Task | Rich Text | Task description |
| StartedAt | Date | Workflow start time |
| FinishedAt | Date | Workflow end time |
| Outcome | Select | success/failure/paused/cancelled/budget_exceeded |
| DomainsVisited | Rich Text | Domains accessed (not full URLs for privacy) |
| ActionClasses | Multi-Select | READ_ONLY, SUBMIT_LOW_RISK, PUBLISH, etc. |
| ApprovedCount | Number | Actions requiring approval |
| AutoSubmitCount | Number | Actions auto-submitted |
| Profile | Select | cheap/normal/deep |
| LocalLogPath | Rich Text | Path to detailed JSONL log |
| Error | Rich Text | Error message if failed |

**Research Radar**:
| Property | Type | Description |
|----------|------|-------------|
| Name | Title | Research query/title |
| Query | Rich Text | Original search query |
| Summary | Rich Text | Synthesized findings (bullet points) |
| Citations | Rich Text | Source URLs |
| NextActions | Rich Text | Suggested follow-ups |
| Uncertainty | Rich Text | Areas of incomplete information |
| CacheKey | Rich Text | Hash for deduplication |
| Profile | Select | Budget profile used |
| SearchCount | Number | Web searches performed |
| FetchCount | Number | Pages fetched |
| ResearchedAt | Date | When research was conducted |

**Posts** (for /site):
| Property | Type | Description |
|----------|------|-------------|
| Name | Title | Post title |
| Status | Select | Draft/Published/Archived |
| SquarespaceDraftId | Rich Text | Linked Squarespace draft ID |
| Template | Select | episode/blog |
| Content | Rich Text | Markdown content (preferred source) |
| ContentHash | Rich Text | SHA-256 hash for idempotent sync |
| LastSyncedAt | Date | Last sync to Squarespace |
| PublishedAt | Date | When published |
| PublishedUrl | URL | Live URL after publish |
| LastError | Rich Text | Most recent error |

#### Content Fetch Strategy

When `/site update-draft` fetches content from Notion:

1. **Preferred**: If the page has a non-empty `Content` rich text property, use it directly
2. **Fallback**: Fetch page blocks and convert to markdown

This allows you to choose:
- Store formatted markdown in the Content property (faster, explicit)
- Use the page body with headings, lists, etc. (more flexible)

#### Idempotent Sync

The site service uses `ContentHash` to skip unnecessary browser automation:

1. When updating a draft, content hash is computed
2. If hash matches the stored `ContentHash` in Notion → **skip browser update**
3. If content changed → perform browser update and store new hash

This prevents redundant Squarespace updates when content hasn't changed.

#### Privacy Notes

- WebOps Log stores **domain names only**, not full URLs
- Form **field values are NEVER logged** to Notion (only field names in local logs if configured)
- Research queries are stored as-is (consider sensitivity when using `/research save`)

## Quick Reference

| Service | Default Port | Health Check |
|---------|--------------|--------------|
| Gateway | 18789 | `curl http://localhost:18789/health` |
| LM Studio | 1234 | `curl http://localhost:1234/v1/models` |

| Config File | Location |
|-------------|----------|
| Main config | `~/.openclaw/openclaw.json` |
| Telegram token | `~/.openclaw/credentials/telegram.token` |
| Notion API key | `~/.config/notion/api_key` |
| DJ Personal workspace | `~/.openclaw/workspaces/dj-personal/` |
| DJ WorkSafe workspace | `~/.openclaw/workspaces/dj-worksafe/` |

| DJ Config Key | Description |
|---------------|-------------|
| `dj.calendarId` | Primary Google Calendar ID (default: "primary") |
| `dj.workBusyCalendarId` | Work Busy (ICS) calendar ID for Outlook sync |
| `dj.workBusyLabel` | Label for busy blocks (default: "Busy (work)") |
| `dj.timezone` | User timezone (e.g., "America/New_York") |

| M4 Config Key | Default | Description |
|---------------|---------|-------------|
| `DJ_WEB_AUTOSUBMIT_ENABLED` | `true` | Enable auto-submit for allowlisted forms |
| `DJ_WEB_AUTOSUBMIT_DAILY_CAP` | `3` | Max auto-submits per day |
| `DJ_WEB_AUTOSUBMIT_WORKFLOW_CAP` | `1` | Max auto-submits per workflow |
| `DJ_WEB_AUTOSUBMIT_REQUIRE_HTTPS` | `true` | Require HTTPS for auto-submit |
| `DJ_WEB_LOG_FIELD_VALUES` | `false` | Log form field values (privacy) |
| `DJ_WEB_WRITE_NOTION_WEBOPS_LOG` | `true` | Write audit to Notion |
| `DJ_RESEARCH_AUTO_SAVE` | `false` | Auto-save research to Notion |
| `DJ_RESEARCH_CACHE_TTL_HOURS` | `24` | Research cache expiration |
| `DJ_SQUARESPACE_SITE_URL` | - | Squarespace site URL |
| `DJ_SQUARESPACE_EDITOR_URL` | - | Squarespace editor URL |
| `DJ_SITE_DEFAULT_TEMPLATE` | `blog` | Default template (blog/episode) |

| M4.5 Notion Config Key | Default | Description |
|------------------------|---------|-------------|
| `NOTION_API_KEY` | **required** | Notion integration API key |
| `DJ_NOTION_WEBOPS_DB_ID` | - | WebOps audit log database ID |
| `DJ_NOTION_RESEARCH_RADAR_DB_ID` | - | Research Radar database ID |
| `DJ_NOTION_POSTS_DB_ID` | - | Posts database ID for /site |
| `DJ_NOTION_THROW_ON_WRITE_ERROR` | `false` | Fail workflows on Notion write errors |
