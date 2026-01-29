# Quick Deploy to Render

✅ **Code pushed to GitHub:** https://github.com/calebnewtonusc/poke-agent-cloud

## Deploy Now (2 minutes):

### Option 1: One-Click Deploy
Click this button:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/calebnewtonusc/poke-agent-cloud)

### Option 2: Manual Deploy

1. **Go to Render Dashboard**
   - https://dashboard.render.com/

2. **Create New Web Service**
   - Click "New +" → "Web Service"
   - Select "Build and deploy from a Git repository"
   - Click "Next"

3. **Connect Repository**
   - Find: `calebnewtonusc/poke-agent-cloud`
   - Click "Connect"

4. **Configure Service**
   - Name: `poke-agent-cloud`
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node agent.js`
   - Plan: Free

5. **Add Environment Variables**

   You'll need to add these three environment variables in the Render dashboard:
   ```
   GITHUB_TOKEN=<your GitHub personal access token>
   CLAUDE_API_KEY=<your Claude/Anthropic API key>
   POKE_API_KEY=<your Poke API key>
   ```

   To find your actual API key values, check your local LaunchAgent configuration:
   ```bash
   cat ~/Library/LaunchAgents/com.caleb.poke-agent.plist
   ```

6. **Click "Create Web Service"**

## What Happens Next

- Render builds and deploys your agent (~2 minutes)
- Agent starts running 24/7 in the cloud
- You can text Poke anytime, anywhere
- No Mac needed!

## Verify It's Working

Once deployed:
1. Text Poke via iMessage
2. Should get response within ~5 seconds
3. Check logs: https://dashboard.render.com/ → poke-agent-cloud → Logs

## Stop Local Services

Once cloud agent is running:
```bash
/Users/joelnewton/Desktop/2026-Code/_System/manage-poke-services.sh stop
```

Only keep the iMessage monitor running locally (for forwarding your texts to webhook).
