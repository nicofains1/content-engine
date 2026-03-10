# Deployment Guide - M1 Mac

## Prerequisites

Install these on the M1 before deploying:

```bash
# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22

# pnpm
npm install -g pnpm

# edge-tts (TTS engine)
pip3 install edge-tts

# ffmpeg (video generation)
brew install ffmpeg

# Python + TikTok uploader
pip3 install tiktok-uploader

# Claude CLI (needed for content generation and learn/god jobs)
npm install -g @anthropic-ai/claude-code
```

## Setup

### 1. Clone the repo

```bash
cd ~
git clone https://github.com/nicofains1/content-engine.git
cd content-engine
pnpm install
pnpm build
```

### 2. Create config.json

```bash
cp config.example.json config.json
```

Edit `config.json` and fill in:
- `reddit.clientId`, `reddit.clientSecret`, `reddit.username`, `reddit.password`
- `youtube.clientId`, `youtube.clientSecret`, `youtube.refreshToken`
- `tiktok.cookiesPath`
- `notifications.whatsappGroupJid` (your WhatsApp group JID)
- All `paths.*` fields (absolute paths on M1)

### 3. Reddit OAuth App

1. Go to https://www.reddit.com/prefs/apps
2. Create app, type: "script"
3. Redirect URI: `http://localhost:8080`
4. Copy client ID (under app name) and client secret

### 4. YouTube OAuth Setup

```bash
# Install gcloud CLI
brew install --cask google-cloud-sdk

# Create OAuth credentials at https://console.cloud.google.com
# Enable YouTube Data API v3
# Download credentials.json (OAuth 2.0 Client ID, type: Desktop app)

# Get refresh token
gcloud auth application-default login
# OR use the youtube-oauth helper script
```

For the refresh token, create a small OAuth flow script or use the Google OAuth Playground at https://developers.google.com/oauthplayground with the `https://www.googleapis.com/auth/youtube.upload` scope.

### 5. WhatsApp QR Scan

```bash
node dist/setup/whatsapp.js
```

Scan the QR code with WhatsApp on your phone. Session is saved to `data/whatsapp-auth/`. This only needs to be done once.

### 6. TikTok Cookies

1. Open browser with TikTok logged in
2. Export cookies using a browser extension (e.g., "Get cookies.txt LOCALLY")
3. Save to the path in `config.tiktok.cookiesPath`

### 7. Download Background Clips and Music

```bash
mkdir -p data/backgrounds data/music data/fonts

# Background clips (gameplay, nature, etc.) - download royalty-free MP4s
# Suggested sources: Pexels, Pixabay, or your own recordings
# Save to data/backgrounds/

# Music tracks (background lo-fi, etc.) - download royalty-free MP3s
# Save to data/music/

# Fonts - download Montserrat Bold
# Save Montserrat-Bold.ttf to data/fonts/
```

### 8. Create Logs Directory

```bash
mkdir -p ~/content-engine/logs
```

### 9. Install launchd Plists

```bash
cp plists/*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.content-engine.*.plist
```

Verify plists are loaded:
```bash
launchctl list | grep content-engine
```

### 10. First Run

Generate the first video manually to verify everything works:

```bash
node dist/jobs/generate.js
```

Check logs:
```bash
tail -f ~/content-engine/logs/generate.log
```

## Job Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| generate | 00:00, 06:00, 12:00, 18:00 | Fetch Reddit post, generate TTS+video |
| post | 01:00, 07:00, 13:00, 19:00 | Upload ready video to YouTube + TikTok |
| metrics | 03:00, 15:00 | Fetch YouTube stats, update CM scores |
| learn | Mon + Thu 05:00 | Darwin evaluation, Claude analysis, self-improvement |
| god | Sun 03:00 | Strategic intervention if population is stagnating |
| notify-daily | 21:00 | WhatsApp daily performance report |
| notify-weekly | Sun 21:00 | WhatsApp weekly performance report |
| cleanup | Sun 04:00 | Delete old video files, vacuum SQLite |

## Managing Plists

```bash
# Stop a job
launchctl unload ~/Library/LaunchAgents/com.content-engine.generate.plist

# Start a job
launchctl load ~/Library/LaunchAgents/com.content-engine.generate.plist

# Run a job immediately (for testing)
launchctl start com.content-engine.generate

# Check status
launchctl list com.content-engine.generate
```

## Updating

```bash
cd ~/content-engine
git pull origin main
pnpm install
pnpm build
```

No need to reload plists after updates - they always call `node dist/jobs/*.js` which picks up the new build.

## Troubleshooting

**WhatsApp disconnected**: Delete `data/whatsapp-auth/` and run `node dist/setup/whatsapp.js` again.

**TikTok upload fails**: Refresh cookies - log into TikTok in browser and re-export cookies.txt.

**YouTube quota exceeded**: YouTube Data API has 10,000 units/day. Each video upload costs 1600 units. With 4 uploads/day you're at 6400 units. Should be fine.

**Build fails after learn job**: The learn job reverts changes automatically if `pnpm build` fails.
