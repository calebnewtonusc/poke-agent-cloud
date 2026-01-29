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

const __dirname = dirname(fileURLToPath(import.meta.url))

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY
const POKE_API_KEY = process.env.POKE_API_KEY
const POLL_INTERVAL = 5000 // 5 seconds

const GITHUB_REPO = 'calebnewtonusc/claude-context'
const MESSAGE_FILE = 'POKE_MESSAGES.md'
const CONTEXT_REPO = 'calebnewtonusc/claude-context'
const TASKS_FILE = 'TASKS.md'

let lastProcessedHash = null
let isProcessing = false
let lastProactiveMessage = Date.now()

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

async function callClaude(conversationMessages, fullContext) {
  console.log(`   📊 Context size: ${fullContext.length} chars`)

  const systemPrompt = `You are Claude, Caleb Newton's personal AI assistant, having a conversation via text message through the Poke platform.

IMPORTANT CONTEXT:
${fullContext}

Guidelines:
- Keep responses concise and conversational, suitable for SMS/iMessage
- You have full access to Caleb's context, projects, and history
- Be proactive and helpful based on what you know about Caleb
- Remember ongoing projects, goals, and preferences
- Text naturally like a close friend/assistant who knows Caleb well

TASK CREATION CAPABILITY:
When Caleb asks you to do something that requires local computer access (file operations, running code, git commands, etc.), you can create tasks for local agents to complete.

To create a task, include this EXACT format anywhere in your response:
[CREATE_TASK priority=high|normal|low]
Task description goes here. Be specific about what needs to be done.
[/CREATE_TASK]

Examples:
- "Can you update my resume?" → Create task to edit resume file
- "Run the tests" → Create task to execute test suite
- "Commit these changes" → Create task for git commit
- "Add this to my todo list" → Create task to update todo file

You can text Caleb proactively about:
- Important updates or reminders
- Project milestones
- Relevant opportunities
- Thoughtful check-ins based on his goals

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

    // Build conversation history
    const conversationMessages = buildConversationHistory(messages)
    console.log(`Built conversation with ${conversationMessages.length} messages`)

    // Call Claude API with full context
    console.log('🤖 Calling Claude API with full context...')
    const claudeResponse = await callClaude(conversationMessages, fullContext)
    console.log(`✓ Claude responded: "${claudeResponse.substring(0, 50)}..."`)

    // Parse and create tasks if requested
    const taskRegex = /\[CREATE_TASK priority=(high|normal|low)\]([\s\S]*?)\[\/CREATE_TASK\]/g
    let match
    let responseForUser = claudeResponse

    while ((match = taskRegex.exec(claudeResponse)) !== null) {
      const priority = match[1]
      const taskDescription = match[2].trim()

      console.log(`📋 Creating ${priority} priority task...`)
      const taskId = await createTask(taskDescription, priority)

      if (taskId) {
        // Replace task marker with confirmation message
        responseForUser = responseForUser.replace(
          match[0],
          `[Task created: ${taskId}]`
        )
      }
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
