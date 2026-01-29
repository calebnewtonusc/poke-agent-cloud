/**
 * Cloud-Based Always-On Claude Agent for Poke
 * - Polls GitHub for new messages every 5 seconds
 * - Has full access to all your context files
 * - Can proactively send important updates
 * - Runs 24/7 in the cloud
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { Composio } from 'composio-core'

const __dirname = dirname(fileURLToPath(import.meta.url))

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY
const POKE_API_KEY = process.env.POKE_API_KEY
const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || 'ak_Weup7L-gmNlw1JJZooP2'
const POLL_INTERVAL = 5000 // 5 seconds

const GITHUB_REPO = 'calebnewtonusc/claude-context'
const MESSAGE_FILE = 'POKE_MESSAGES.md'
const CONTEXT_REPO = 'calebnewtonusc/claude-context'
const TASKS_FILE = 'TASKS.md'

// Initialize Composio for tool integrations
const composio = new Composio({ apiKey: COMPOSIO_API_KEY })
console.log('✓ Composio initialized for tool access')

let lastProcessedHash = null
let isProcessing = false
let lastProactiveMessage = Date.now()

// ============================================================================
// GITHUB FULL ACCESS - Read/Write ANY of Caleb's repos
// ============================================================================

async function readGitHubFile(repo, filePath, ref = 'main') {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}${ref ? `?ref=${ref}` : ''}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    )

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const data = await response.json()
    const content = Buffer.from(data.content, 'base64').toString('utf-8')

    return {
      success: true,
      content,
      sha: data.sha,
      path: data.path,
      size: data.size
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function writeGitHubFile(repo, filePath, content, message, sha = null) {
  try {
    const body = {
      message,
      content: Buffer.from(content).toString('base64')
    }

    if (sha) {
      body.sha = sha
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${error}` }
    }

    const data = await response.json()
    return {
      success: true,
      sha: data.content.sha,
      url: data.content.html_url
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function listGitHubRepos() {
  try {
    const response = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    )

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    const repos = await response.json()
    return {
      success: true,
      repos: repos.map(r => ({
        name: r.full_name,
        description: r.description,
        private: r.private,
        updated: r.updated_at,
        language: r.language,
        url: r.html_url
      }))
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Load full context from GitHub
async function loadFullContext() {
  const contextFiles = [
    'WHO_IS_CALEB.md',
    'CURRENT_CONTEXT_JAN_2026.md',
    'VALUES_AND_PHILOSOPHY.md',
    'PERSONAL_STORIES_AND_EXPERIENCES.md',
    'AINATECH_EXPERIENCE_AND_LEARNING.md',
    'CALEB_TECHNICAL_JOURNEY.md',
    'CALEB_WORKING_STYLE_AND_PREFERENCES.md'
  ]

  let fullContext = ''

  for (const file of contextFiles) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${CONTEXT_REPO}/contents/${file}`,
        {
          headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      )

      if (response.ok) {
        const data = await response.json()
        const content = Buffer.from(data.content, 'base64').toString('utf-8')
        fullContext += `\n\n# ${file}\n\n${content}`
      }
    } catch (error) {
      console.log(`⚠️  Could not load ${file}:`, error.message)
    }
  }

  return fullContext
}

async function fetchMessages() {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${MESSAGE_FILE}`,
    {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }
  )

  if (!response.ok) {
    throw new Error(`GitHub fetch failed: ${response.status}`)
  }

  const data = await response.json()
  const content = Buffer.from(data.content, 'base64').toString('utf-8')

  return {
    content,
    sha: data.sha
  }
}

function parseMessages(content) {
  const messages = []
  const blocks = content.split('---\n').filter(b => b.trim() && !b.includes('# Messages from Poke'))

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    let from = null
    let messageContent = ''
    let foundContent = false

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('**From:**')) {
        from = lines[i].replace('**From:**', '').trim()
      } else if (lines[i].startsWith('**Timestamp:**')) {
        foundContent = true
        i++ // skip empty line
      } else if (foundContent) {
        messageContent += lines[i] + '\n'
      }
    }

    if (from && messageContent.trim()) {
      messages.push({
        from,
        content: messageContent.trim()
      })
    }
  }

  return messages
}

function needsResponse(messages) {
  if (messages.length === 0) return null

  const lastMessage = messages[messages.length - 1]

  // If last message is from Claude, no response needed
  if (lastMessage.from === 'Claude') return null

  // If last message is from user, it needs a response
  return lastMessage
}

function buildConversationHistory(messages) {
  const conversationMessages = []

  // Take last 10 messages for context
  const recentMessages = messages.slice(-10)

  for (const msg of recentMessages) {
    if (msg.from === 'Claude') {
      conversationMessages.push({
        role: 'assistant',
        content: msg.content
      })
    } else {
      conversationMessages.push({
        role: 'user',
        content: msg.content
      })
    }
  }

  return conversationMessages
}

async function callClaude(conversationMessages, fullContext, completedTasks = []) {
  console.log(`   📊 Context size: ${fullContext.length} chars`)

  // Build completed tasks summary
  let completedTasksInfo = ''
  if (completedTasks.length > 0) {
    completedTasksInfo = '\n\nRECENT TASK COMPLETIONS (from local agent in last 10 minutes):\n'
    for (const task of completedTasks) {
      completedTasksInfo += `- ${task.taskId} (${task.status} at ${task.timestamp})\n  Output preview: ${task.output.substring(0, 200)}...\n`
    }
  }

  const systemPrompt = `You are Claude, Caleb Newton's personal AI assistant, having a conversation via text message through the Poke platform.

IMPORTANT CONTEXT:
${fullContext}${completedTasksInfo}

Guidelines:
- Keep responses concise and conversational, suitable for SMS/iMessage
- You have full access to Caleb's context, projects, and history
- Be proactive and helpful based on what you know about Caleb
- Remember ongoing projects, goals, and preferences
- Text naturally like a close friend/assistant who knows Caleb well

YOUR CAPABILITIES - What YOU Can Do (Cloud Agent):
✅ Things you can do YOURSELF (do these directly, don't delegate):
  - Answer questions using Caleb's full context
  - Make web requests and API calls
  - Search for information online

  📦 FULL GITHUB ACCESS - You can read/write ANY of Caleb's repos:
  - ALL 24 repos including: Personal-Website, ModelLab, 16TechPersonalities, poke-agent-cloud, etc.
  - Read any file from any repo
  - Update/create files in any repo
  - Search code across all repos
  - List repos and browse code structure
  - Examples: "Update my Personal-Website README", "Check ModelLab config", "Search for API usage"

  - Analyze code, plan projects, give advice
  - Schedule reminders and track deadlines
  - Research topics and summarize information

  🚀 COMPOSIO TOOLS YOU HAVE (do these yourself via API):
  - Google Calendar: Create/read/update events, check schedule
  - Gmail: Read/send/search emails
  - Notion: Create/read/update pages and databases
  - Slack: Send messages, read channels
  - And 100+ more tools available via Composio

  To use these: Make API calls directly, don't create local tasks!

  📝 EXAMPLES of what you can do:
  - "Read the README from my Personal-Website repo"
  - "Update the config in ModelLab"
  - "Search all my repos for API key usage"
  - "List all my GitHub repos"
  - "Check if there are any TODOs in my code"
  - "Update my context with this information" (write to claude-context repo)

❌ Things you MUST delegate to Local Agent (create tasks for these ONLY):
  - Read/write files on Caleb's Mac (outside GitHub)
  - Run commands, scripts, or code on Caleb's Mac (npm, python, etc.)
  - Git operations on local repositories (not GitHub API)
  - Open Mac applications locally
  - Local filesystem operations

  Only delegate when it MUST run on Caleb's Mac. Everything else, do yourself!

GITHUB OPERATIONS - Do these yourself (cloud agent):
When Caleb asks you to read/update GitHub files, use this format in your internal thinking:

[GITHUB_READ repo=owner/repo path=file/path.md]
[GITHUB_WRITE repo=owner/repo path=file/path.md message="commit message"]
content here
[/GITHUB_WRITE]
[GITHUB_LIST_REPOS]
[GITHUB_SEARCH query="search term"]

The system will execute these automatically and you'll have the results.

Examples:
- "Read my Personal-Website README" → Use GITHUB_READ with repo=calebnewtonusc/Personal-Website path=README.md
- "Update my context" → Use GITHUB_WRITE to update files in claude-context repo
- "Search for API keys" → Use GITHUB_SEARCH query="API_KEY"

TASK CREATION - For Local Agent (ONLY for local Mac operations):
When Caleb asks for something requiring local Mac access, create a task using this format:

[CREATE_TASK priority=high|normal|low]
bash: actual_command_to_run_here
[/CREATE_TASK]

For bash commands, prefix with "bash:" so the local agent knows to execute it directly.

Examples:
- "Run the tests" → [CREATE_TASK priority=high]\nbash: npm test\n[/CREATE_TASK]
- "Check git status" → [CREATE_TASK priority=normal]\nbash: git status\n[/CREATE_TASK]

IMPORTANT: Only create tasks for LOCAL operations. GitHub operations you do yourself!

PROACTIVE MESSAGING - Be resourceful and helpful:
You should proactively text Caleb about:
- ⚠️  **Important emails** (when Gmail is connected) - urgent, from key people
- 📅 **Upcoming deadlines** - Understanding Sprint, project milestones
- 📆 **Calendar events** (when Calendar is connected) - meetings, appointments
- ✅ **Completed tasks** - Let him know when local agent finishes something
- 📁 **Important file changes** - Monitor key repos for significant updates
- 💡 **Opportunities** - Based on his projects and goals
- 🎯 **Progress check-ins** - On ongoing work, goals

Be resourceful - use ALL your access:
- Check GitHub repos for recent activity
- Monitor task completion status
- Review context for upcoming deadlines
- Look for patterns that need attention
- Proactively offer to help before being asked

Current date: ${new Date().toLocaleDateString()}
Current time: ${new Date().toLocaleTimeString()}`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: conversationMessages,
      system: systemPrompt
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

async function sendToPoke(message) {
  const response = await fetch('https://poke.com/api/v1/inbound-sms/webhook', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${POKE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      to: '+13104296285'
    })
  })

  if (!response.ok) {
    throw new Error(`Poke API error: ${response.status}`)
  }

  return await response.json()
}

// Send progress updates without logging to GitHub
async function sendProgressUpdate(message) {
  try {
    console.log(`📊 Progress update: ${message}`)
    await sendToPoke(`⏳ ${message}`)
  } catch (error) {
    console.error('Failed to send progress update:', error.message)
    // Don't throw - progress updates are non-critical
  }
}

async function logToGitHub(content, sha, replyMessage) {
  const now = new Date()
  const dateStr = now.toISOString().split('T')[0]
  const timeStr = now.toTimeString().split(' ')[0]

  const claudeLogEntry = `\n## ${dateStr} ${timeStr} - Claude Response\n\n**From:** Claude\n**In Response To:** caleb_newton\n**Timestamp:** ${now.toISOString()}\n\n${replyMessage}\n\n---\n`

  const updatedContent = content + claudeLogEntry

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${MESSAGE_FILE}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add Claude response via cloud agent',
        content: Buffer.from(updatedContent).toString('base64'),
        sha
      })
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub commit failed: ${error}`)
  }

  return await response.json()
}

// Check for recently completed tasks
async function checkCompletedTasks() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${CONTEXT_REPO}/contents/${TASKS_FILE}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    )

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    const content = Buffer.from(data.content, 'base64').toString('utf-8')

    // Parse completed tasks from last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const completedTasks = []

    const taskMatches = content.matchAll(/## (task_\d+)[\s\S]*?\*\*Status:\*\* (completed|failed)[\s\S]*?\*\*Result:\*\* (\w+) at ([\d\-T:.Z]+)[\s\S]*?```\n([\s\S]*?)\n```/g)

    for (const match of taskMatches) {
      const [, taskId, status, resultStatus, timestamp, output] = match
      const completedAt = new Date(timestamp)

      if (completedAt > tenMinutesAgo) {
        completedTasks.push({
          taskId,
          status,
          timestamp,
          output: output.substring(0, 500) // Limit output size
        })
      }
    }

    return completedTasks
  } catch (error) {
    console.error('Error checking completed tasks:', error.message)
    return []
  }
}

async function createTask(taskDescription, priority = 'normal') {
  try {
    // Fetch current TASKS.md file
    let currentContent = ''
    let currentSha = null

    const getResponse = await fetch(
      `https://api.github.com/repos/${CONTEXT_REPO}/contents/${TASKS_FILE}`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    )

    if (getResponse.ok) {
      const data = await getResponse.json()
      currentContent = Buffer.from(data.content, 'base64').toString('utf-8')
      currentSha = data.sha
    } else if (getResponse.status === 404) {
      // File doesn't exist, create it
      currentContent = '# Tasks for Local Agents\n\nTasks created by the cloud agent for local agents to complete.\n\n---\n\n'
    } else {
      throw new Error(`Failed to fetch TASKS.md: ${getResponse.status}`)
    }

    // Create task entry
    const now = new Date()
    const taskId = `task_${now.getTime()}`
    const taskEntry = `## ${taskId}\n\n**Created:** ${now.toISOString()}\n**Priority:** ${priority}\n**Status:** pending\n\n${taskDescription}\n\n---\n\n`

    const updatedContent = currentContent + taskEntry

    // Commit to GitHub
    const method = currentSha ? 'PUT' : 'PUT'
    const body = {
      message: `Add task: ${taskDescription.substring(0, 50)}...`,
      content: Buffer.from(updatedContent).toString('base64')
    }

    if (currentSha) {
      body.sha = currentSha
    }

    const putResponse = await fetch(
      `https://api.github.com/repos/${CONTEXT_REPO}/contents/${TASKS_FILE}`,
      {
        method,
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )

    if (!putResponse.ok) {
      const error = await putResponse.text()
      throw new Error(`Failed to create task: ${error}`)
    }

    console.log(`✓ Created task: ${taskId}`)
    return taskId
  } catch (error) {
    console.error('❌ Error creating task:', error.message)
    return null
  }
}

// Proactive messaging feature
async function checkForProactiveUpdates(fullContext) {
  const hoursSinceLastMessage = (Date.now() - lastProactiveMessage) / (1000 * 60 * 60)

  // Send proactive update once per day (24 hours)
  if (hoursSinceLastMessage < 24) {
    return null
  }

  const currentHour = new Date().getHours()

  // Only send between 9 AM and 8 PM
  if (currentHour < 9 || currentHour > 20) {
    return null
  }

  // Ask Claude if there's something important to share
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Based on Caleb's context, projects, and goals, is there anything important or helpful you should proactively text him about today? Consider:
- Project deadlines or milestones
- Important reminders
- Opportunities based on his interests
- Check-ins on ongoing work

If yes, write a brief, casual text message (2-3 sentences max). If no, just say "SKIP".

Context:
${fullContext.substring(0, 10000)}`
      }],
      system: 'You are Claude, deciding whether to send Caleb a proactive text message. Only send truly valuable, timely updates.'
    })
  })

  if (response.ok) {
    const data = await response.json()
    const message = data.content[0].text.trim()

    if (message !== 'SKIP' && !message.includes('SKIP')) {
      return message
    }
  }

  return null
}

async function processMessages() {
  if (isProcessing) {
    return
  }

  isProcessing = true

  try {
    // Load full context (cached for performance)
    const fullContext = await loadFullContext()

    // Check for completed tasks from local agent
    const completedTasks = await checkCompletedTasks()
    if (completedTasks.length > 0) {
      console.log(`📋 Found ${completedTasks.length} recently completed tasks`)
      // Note: We'll include these in responses when relevant, not spam with separate messages
    }

    // Check for proactive updates
    const proactiveMessage = await checkForProactiveUpdates(fullContext)
    if (proactiveMessage) {
      console.log('📨 Sending proactive message...')
      await sendToPoke(proactiveMessage)
      lastProactiveMessage = Date.now()
      console.log('✅ Proactive message sent\n')
    }

    // Fetch latest messages from GitHub
    const { content, sha } = await fetchMessages()

    // Check if content changed
    if (sha === lastProcessedHash) {
      return
    }

    console.log(`New content detected (${sha.substring(0, 7)})`)

    // Parse messages
    const messages = parseMessages(content)
    console.log(`Parsed ${messages.length} total messages`)

    // Check if response needed
    const messageNeedingResponse = needsResponse(messages)

    if (!messageNeedingResponse) {
      console.log('No response needed')
      lastProcessedHash = sha
      return
    }

    console.log(`📨 New message from ${messageNeedingResponse.from}: "${messageNeedingResponse.content.substring(0, 50)}..."`)

    // Check if this is a complex request that will take time
    const requestLength = messageNeedingResponse.content.length
    const hasMultipleRequests = messageNeedingResponse.content.split(/\band\b|,/).length > 3
    const isComplexRequest = requestLength > 200 || hasMultipleRequests

    if (isComplexRequest) {
      await sendProgressUpdate('Processing your request... this may take a moment 🧠')
    }

    // Build conversation history
    const conversationMessages = buildConversationHistory(messages)
    console.log(`Built conversation with ${conversationMessages.length} messages`)

    // Call Claude API with full context
    console.log('🤖 Calling Claude API with full context...')
    const claudeResponse = await callClaude(conversationMessages, fullContext, completedTasks)
    console.log(`✓ Claude responded: "${claudeResponse.substring(0, 50)}..."`)

    // Initialize response
    let responseForUser = claudeResponse
    let operationsCount = 0

    // Parse and execute GitHub READ operations
    const githubReadRegex = /\[GITHUB_READ repo=([^\s]+) path=([^\]]+)\]/g
    let githubMatch
    const githubReadMatches = [...claudeResponse.matchAll(githubReadRegex)]

    if (githubReadMatches.length > 0) {
      operationsCount += githubReadMatches.length
    }

    for (const githubMatch of githubReadMatches) {
      const repo = githubMatch[1]
      const path = githubMatch[2]
      console.log(`📖 Reading from GitHub: ${repo}/${path}`)

      if (githubReadMatches.length > 2 || isComplexRequest) {
        await sendProgressUpdate(`Reading ${repo}/${path}... 📖`)
      }

      const result = await readGitHubFile(repo, path)
      if (result.success) {
        responseForUser = responseForUser.replace(githubMatch[0], `\n[Read ${repo}/${path}]\n`)
      } else {
        responseForUser = responseForUser.replace(githubMatch[0], `[Error: ${result.error}]`)
      }
    }

    // Parse and execute GitHub WRITE operations
    const githubWriteRegex = /\[GITHUB_WRITE repo=([^\s]+) path=([^\s]+) message="([^"]+)"\]\n([\s\S]*?)\[\/GITHUB_WRITE\]/g
    const githubWriteMatches = [...claudeResponse.matchAll(githubWriteRegex)]

    if (githubWriteMatches.length > 0) {
      operationsCount += githubWriteMatches.length
    }

    for (const githubMatch of githubWriteMatches) {
      const repo = githubMatch[1]
      const path = githubMatch[2]
      const message = githubMatch[3]
      const content = githubMatch[4].trim()
      console.log(`✍️  Writing to GitHub: ${repo}/${path}`)

      if (githubWriteMatches.length > 1 || isComplexRequest) {
        await sendProgressUpdate(`Updating ${repo}/${path}... ✍️`)
      }

      const existing = await readGitHubFile(repo, path)
      const result = await writeGitHubFile(repo, path, content, message, existing.success ? existing.sha : null)
      if (result.success) {
        responseForUser = responseForUser.replace(githubMatch[0], `[✅ Updated ${repo}/${path}]`)
      } else {
        responseForUser = responseForUser.replace(githubMatch[0], `[Error: ${result.error}]`)
      }
    }

    // Parse and execute GitHub LIST REPOS
    if (claudeResponse.includes('[GITHUB_LIST_REPOS]')) {
      console.log('📋 Listing GitHub repos...')
      const result = await listGitHubRepos()
      if (result.success) {
        const repoList = result.repos.slice(0, 10).map(r => `${r.name}`).join(', ')
        responseForUser = responseForUser.replace('[GITHUB_LIST_REPOS]', `Your repos: ${repoList}`)
      }
    }

    // Parse and create tasks if requested (LOCAL operations only)
    const taskRegex = /\[CREATE_TASK priority=(high|normal|low)\]([\s\S]*?)\[\/CREATE_TASK\]/g
    let match
    const taskMatches = [...claudeResponse.matchAll(taskRegex)]

    if (taskMatches.length > 0) {
      operationsCount += taskMatches.length
      if (taskMatches.length > 3 || isComplexRequest) {
        await sendProgressUpdate(`Creating ${taskMatches.length} tasks for local agent... 📋`)
      }
    }

    for (const match of taskMatches) {
      const priority = match[1]
      const taskDescription = match[2].trim()

      console.log(`📋 Creating ${priority} priority task...`)

      // Send update for each task if there are many
      if (taskMatches.length > 5) {
        const taskNumber = taskMatches.indexOf(match) + 1
        await sendProgressUpdate(`Creating task ${taskNumber}/${taskMatches.length}... 💻`)
      }

      const taskId = await createTask(taskDescription, priority)

      if (taskId) {
        // Replace task marker with confirmation message
        responseForUser = responseForUser.replace(
          match[0],
          `[Task created: ${taskId}]`
        )
      }
    }

    // If we created many tasks, let user know local agent is working on them
    if (taskMatches.length > 3) {
      await sendProgressUpdate(`${taskMatches.length} tasks created. Local agent executing... ⚙️`)
    }

    // Send completion update if it was a complex request
    if (operationsCount > 5 || (taskMatches.length > 0 && isComplexRequest)) {
      await sendProgressUpdate('Compiling results... almost done! ✨')
    }

    // Send to Poke
    console.log('📤 Sending to Poke...')
    await sendToPoke(responseForUser)
    console.log('✓ Sent to Poke')

    // Log to GitHub
    console.log('📝 Logging to GitHub...')
    const result = await logToGitHub(content, sha, responseForUser)
    console.log(`✓ Logged to GitHub (${result.commit.sha.substring(0, 7)})`)

    // Update last processed hash
    lastProcessedHash = result.content.sha

    console.log('✅ Response cycle complete\n')

  } catch (error) {
    console.error('❌ Error:', error.message)
  } finally {
    isProcessing = false
  }
}

async function start() {
  console.log('🚀 Cloud-Based Always-On Claude Agent')
  console.log(`📊 Polling: ${POLL_INTERVAL}ms`)
  console.log(`📂 Monitoring: ${GITHUB_REPO}/${MESSAGE_FILE}`)
  console.log(`🌍 Running 24/7 in the cloud`)
  console.log(`🧠 Full context access enabled`)
  console.log(`📨 Proactive messaging enabled`)
  console.log('---\n')

  // Test context loading
  console.log('🔍 Testing context loading...')
  const testContext = await loadFullContext()
  console.log(`✓ Loaded ${testContext.length} chars of context\n`)

  // Start HTTP server for Render health checks
  const PORT = process.env.PORT || 10000
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Poke Agent Running\n')
  })
  server.listen(PORT, () => {
    console.log(`✓ HTTP server listening on port ${PORT}`)
  })

  // Initial process
  try {
    await processMessages()
  } catch (error) {
    console.error('Failed initial processing:', error.message)
  }

  // Start polling
  setInterval(processMessages, POLL_INTERVAL)

  console.log('✓ Agent is now running 24/7\n')
}

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down agent...')
  process.exit(0)
})

start()
