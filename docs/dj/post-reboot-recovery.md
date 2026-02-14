# Post-Reboot Recovery Guide

How to get OpenClaw back online after a machine restart, and how to prevent downtime in the future.

## What Happened (Feb 2026 Incident)

After a Windows restart, the gateway refused to start and Telegram stopped responding. Rolling back to the last commit didn't help because the problems were all in **runtime state and environment**, not in code.

### Root Cause Chain

| # | Problem | Symptom | Why reboot triggered it |
|---|---------|---------|-------------------------|
| 1 | **Missing `gateway.auth.token`** | Gateway exits immediately: `"Gateway auth is set to token, but no token is configured."` | Token was never persisted in config; may have been passed via env var or CLI flag in the previous session. After reboot, the env/flag was gone. |
| 2 | **`CLAUDECODE` env var leak** | `claude -p` child processes refuse to start: `"Claude Code cannot be launched inside another Claude Code session."` | After reboot, gateway was started from inside a Claude Code terminal (interactive session sets `CLAUDECODE` in the environment). The gateway inherited it and passed it to child `claude` processes. |
| 3 | **Claude Code CLI concurrency lock** | `claude-cli/opus` hangs silently for 180s, then times out | An interactive Claude Code session was running in another terminal. Only one Claude Code process can use the print API at a time. |
| 4 | **WSL2 cross-filesystem I/O** | Gateway takes 3-4 minutes to start (zero output for ~3 min) | The repo lives on `/mnt/d/` (Windows NTFS). Node module resolution across the WSL2/NTFS bridge is extremely slow after a cold boot (no filesystem cache). |

### What We Fixed

1. **Added `gateway.auth.token`** to `~/.openclaw/openclaw.json`:
   ```json
   "gateway": {
     "mode": "local",
     "auth": {
       "token": "<generated-hex-token>"
     }
   }
   ```

2. **Added `CLAUDECODE` to `clearEnv`** for the `claude-cli` backend:
   ```json
   "claude-cli": {
     "clearEnv": ["ANTHROPIC_API_KEY", "CLAUDECODE"]
   }
   ```

3. **Discord was already disabled** (triple: `channels.discord.enabled: false`, `plugins.deny: ["discord"]`, `plugins.entries.discord.enabled: false`). The issue was stale build output from before the config change.

## Post-Reboot Checklist

Run this after every restart to get OpenClaw back online quickly.

### Quick Start (copy-paste)

```bash
# 1. Kill any stale processes
pkill -f "openclaw" 2>/dev/null
pkill -f "tsgo.*watch" 2>/dev/null

# 2. Verify credentials exist
echo "--- Credentials check ---"
test -f ~/.openclaw/credentials/telegram-bot-token.txt && echo "Telegram token: OK" || echo "Telegram token: MISSING"
test -f ~/.openclaw/credentials/notion-api-key.txt && echo "Notion key: OK" || echo "Notion key: MISSING"

# 3. Verify bot token is valid
echo "--- Bot token check ---"
curl -s "https://api.telegram.org/bot$(cat ~/.openclaw/credentials/telegram-bot-token.txt)/getMe" | grep -o '"username":"[^"]*"'

# 4. Verify gateway auth token is in config
echo "--- Gateway auth check ---"
grep -q '"auth"' ~/.openclaw/openclaw.json && echo "Gateway auth: OK" || echo "Gateway auth: MISSING (run: openclaw config set gateway.auth.token <token>)"

# 5. Build (first build after reboot is slow on WSL2)
cd /mnt/d/Dev/Clawdbot/openclaw
pnpm build

# 6. Start gateway (expect 3-4 min startup on WSL2 cold boot)
node openclaw.mjs gateway --force --verbose
```

### Detailed Steps

#### Step 1: Kill stale processes

After a hard restart, orphaned Node processes may hold the port or lock files.

```bash
pkill -f "openclaw" 2>/dev/null
pkill -f "tsgo.*watch" 2>/dev/null
sleep 2
# Verify port is free
ss -tlnp | grep 18789 || echo "Port 18789 is free"
```

#### Step 2: Verify credentials

```bash
# Telegram bot token
cat ~/.openclaw/credentials/telegram-bot-token.txt | wc -c
# Should be ~46 bytes. If 0 or missing, re-create from @BotFather.

# Notion API key
cat ~/.openclaw/credentials/notion-api-key.txt | wc -c
# Should be non-zero. If missing, get from notion.so/my-integrations.
```

#### Step 3: Test Telegram bot token

```bash
curl -s "https://api.telegram.org/bot$(cat ~/.openclaw/credentials/telegram-bot-token.txt)/getMe"
# Should return {"ok":true,"result":{"username":"Callum_Primebot",...}}
# If "ok":false, the token is expired or revoked. Get a new one from @BotFather.
```

#### Step 4: Verify config has gateway auth token

```bash
grep "gateway.auth.token\|\"auth\"" ~/.openclaw/openclaw.json
# If missing, generate and add one:
TOKEN=$(openssl rand -hex 32)
echo "Add this to openclaw.json under gateway.auth:"
echo "  \"token\": \"$TOKEN\""
```

#### Step 5: Check for interactive Claude Code sessions

```bash
ps aux | grep -E "claude$|claude " | grep -v grep
# If an interactive Claude Code session is running, claude-cli/opus will
# fail over to codex-cli/gpt-5-codex. This is expected behavior.
# For best performance, start the gateway from a CLEAN terminal (not inside
# Claude Code) so that CLAUDECODE env var is not inherited.
```

#### Step 6: Start gateway

```bash
# Option A: Direct start (faster, no recompile)
cd /mnt/d/Dev/Clawdbot/openclaw
node openclaw.mjs gateway --force --verbose

# Option B: Watch mode (auto-recompiles on code changes, slower startup)
pnpm gateway:watch
```

**IMPORTANT**: First startup after reboot takes 3-4 minutes on WSL2 due to cross-filesystem module loading. Don't panic if there's no output for several minutes.

#### Step 7: Verify Telegram is responding

Watch the logs for:
```
[telegram] [default] starting provider (@Callum_Primebot)
```

Then send a test message to the bot on Telegram. Logs should show:
```
telegram inbound: chatId=... from=telegram:... preview="..."
```

## Prevention: Making OpenClaw Survive Reboots

### 1. Gateway as a systemd service (recommended)

Create a service file so the gateway starts automatically on boot:

```bash
sudo tee /etc/systemd/system/openclaw-gateway.service << 'EOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=aurora
WorkingDirectory=/mnt/d/Dev/Clawdbot/openclaw
ExecStart=/home/aurora/.nvm/versions/node/v22.16.0/bin/node openclaw.mjs gateway --force --verbose
Restart=on-failure
RestartSec=10
# Clean environment - no CLAUDECODE leakage
Environment=PATH=/home/aurora/.nvm/versions/node/v22.16.0/bin:/home/aurora/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=/home/aurora
Environment=NODE_ENV=production
# Source credentials from files, not env vars
StandardOutput=append:/tmp/openclaw/gateway.log
StandardError=append:/tmp/openclaw/gateway.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable openclaw-gateway
sudo systemctl start openclaw-gateway

# Check status
sudo systemctl status openclaw-gateway
journalctl -u openclaw-gateway -f
```

Benefits:
- Starts automatically on boot
- Clean environment (no `CLAUDECODE` leak)
- Auto-restarts on crash
- Logs managed by journald

### 2. Startup validation script

Save as `~/bin/openclaw-doctor.sh`:

```bash
#!/bin/bash
set -e
echo "=== OpenClaw Post-Boot Doctor ==="

FAIL=0

# Check credentials
for f in telegram-bot-token.txt notion-api-key.txt; do
  if [ ! -s ~/.openclaw/credentials/$f ]; then
    echo "FAIL: Missing credential: $f"
    FAIL=1
  else
    echo "  OK: $f"
  fi
done

# Check gateway auth in config
if ! grep -q '"auth"' ~/.openclaw/openclaw.json 2>/dev/null; then
  echo "FAIL: No gateway.auth.token in openclaw.json"
  FAIL=1
else
  echo "  OK: gateway.auth.token configured"
fi

# Check CLAUDECODE env var
if [ -n "$CLAUDECODE" ]; then
  echo "WARN: CLAUDECODE env var is set. Gateway child processes may fail."
  echo "      Start gateway from a clean terminal, or ensure clearEnv includes CLAUDECODE."
else
  echo "  OK: CLAUDECODE not in environment"
fi

# Check bot token validity
BOT_RESPONSE=$(curl -s "https://api.telegram.org/bot$(cat ~/.openclaw/credentials/telegram-bot-token.txt)/getMe" 2>/dev/null)
if echo "$BOT_RESPONSE" | grep -q '"ok":true'; then
  BOT_NAME=$(echo "$BOT_RESPONSE" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
  echo "  OK: Telegram bot @$BOT_NAME"
else
  echo "FAIL: Telegram bot token invalid"
  FAIL=1
fi

# Check port availability
if ss -tlnp 2>/dev/null | grep -q 18789; then
  echo "  OK: Gateway already listening on :18789"
else
  echo "INFO: Gateway not running on :18789 (start with: node openclaw.mjs gateway --force --verbose)"
fi

# Check for concurrent Claude Code sessions
CLAUDE_PROCS=$(ps aux | grep -c "[c]laude$" 2>/dev/null || echo 0)
if [ "$CLAUDE_PROCS" -gt 0 ]; then
  echo "WARN: $CLAUDE_PROCS interactive Claude Code session(s) running."
  echo "      claude-cli/opus will fail over to codex-cli fallback."
fi

if [ $FAIL -ne 0 ]; then
  echo ""
  echo "=== ISSUES FOUND - fix above before starting gateway ==="
  exit 1
else
  echo ""
  echo "=== ALL CHECKS PASSED ==="
fi
```

```bash
chmod +x ~/bin/openclaw-doctor.sh
```

### 3. Config completeness

Ensure `~/.openclaw/openclaw.json` is self-contained. Everything needed to start should be in the config file or in credential files it references. Never rely on:
- Environment variables from interactive sessions
- CLI flags that you'll forget after a reboot
- Tokens passed only once via `--token`

**Current config requirements** (as of Feb 2026):

| Key | Required | Current value |
|-----|----------|---------------|
| `gateway.auth.token` | Yes | Set (hex token) |
| `channels.telegram.tokenFile` | Yes | `/home/aurora/.openclaw/credentials/telegram-bot-token.txt` |
| `channels.telegram.enabled` | Yes | `true` |
| `channels.discord.enabled` | Yes | `false` |
| `plugins.deny` | Recommended | `["discord"]` |
| `agents.defaults.cliBackends.claude-cli.clearEnv` | Yes | `["ANTHROPIC_API_KEY", "CLAUDECODE"]` |

### 4. WSL2 performance: move to native filesystem

The single biggest performance improvement would be moving the repo from `/mnt/d/` (Windows NTFS) to the native Linux filesystem (`/home/aurora/`):

```bash
# One-time migration
cp -r /mnt/d/Dev/Clawdbot/openclaw ~/Dev/openclaw
cd ~/Dev/openclaw
pnpm install

# Update systemd service WorkingDirectory accordingly
```

This would reduce gateway startup from 3-4 minutes to ~10-15 seconds.

**Trade-off**: You lose direct Windows file access (VS Code WSL remote still works fine).

## Known Limitations

1. **Claude Code CLI concurrency**: Only one `claude` process can run at a time. When an interactive session is active, the gateway's `claude-cli/opus` backend will always fail over to `codex-cli/gpt-5-codex`. This is by design and cannot be fixed without Anthropic changing the CLI.

2. **WSL2 cold boot**: First startup is always slow on `/mnt/d/`. Subsequent starts (while WSL is warm) are much faster due to filesystem caching.

3. **`gateway:watch` overhead**: The `tsgo` TypeScript watch compiler uses 1-2GB RAM and 100% CPU during initial compile. Prefer direct `node openclaw.mjs gateway` for production use.
