# Poke Agent Cloud

24/7 cloud-based Claude agent for Poke texting with full context access.

## Features

- ✅ Runs 24/7 in the cloud (no Mac needed)
- ✅ Full access to all your context files
- ✅ Proactive daily updates (9 AM - 8 PM)
- ✅ Conversation memory maintained
- ✅ Responds within ~5 seconds

## Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/calebnewtonusc/poke-agent-cloud)

### Environment Variables Required

```
GITHUB_TOKEN=your_github_token
CLAUDE_API_KEY=your_claude_api_key
POKE_API_KEY=your_poke_api_key
```

## How It Works

1. **Polls GitHub** every 5 seconds for new messages
2. **Loads your full context** from GitHub (WHO_IS_CALEB.md, etc.)
3. **Calls Claude API** with conversation history + full context
4. **Sends response** via Poke API to your iMessage
5. **Logs to GitHub** for conversation persistence
6. **Proactive messaging** - Texts you important updates once daily

## Architecture

```
You → Text Poke (iMessage)
  ↓
iMessage Monitor (Mac) → Webhook → GitHub
  ↓
Cloud Agent (polls GitHub)
  ↓
Claude API (with full context)
  ↓
Poke API → Your iMessage
```

## Logs

View logs at: https://dashboard.render.com/

## Manual Deployment

1. Fork this repo
2. Go to https://render.com
3. New Web Service → Connect repo
4. Add environment variables
5. Deploy!
