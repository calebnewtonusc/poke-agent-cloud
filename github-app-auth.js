/**
 * GitHub App Authentication Helper
 * Generates installation access tokens for the GitHub App
 * Rate limit: 15,000 requests/hour (3x more than personal tokens)
 */

import { createAppAuth } from '@octokit/auth-app'
import { readFileSync } from 'fs'

const APP_ID = process.env.GITHUB_APP_ID || '2752810'
const INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID || '106770428'
const PRIVATE_KEY_PATH = process.env.GITHUB_APP_PRIVATE_KEY_PATH || './claude-agent-app.pem'

let cachedToken = null
let tokenExpiry = null

/**
 * Get a valid GitHub App installation access token
 * Tokens are cached and automatically refreshed when they expire
 */
export async function getGitHubToken() {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken
  }

  // Generate new token
  try {
    const privateKey = readFileSync(PRIVATE_KEY_PATH, 'utf8')

    const auth = createAppAuth({
      appId: APP_ID,
      privateKey: privateKey,
      installationId: INSTALLATION_ID,
    })

    const { token, expiresAt } = await auth({ type: 'installation' })

    cachedToken = token
    tokenExpiry = new Date(expiresAt).getTime()

    console.log(`✓ GitHub App token generated (expires: ${expiresAt})`)

    return token
  } catch (error) {
    console.error('❌ Failed to generate GitHub App token:', error.message)
    throw error
  }
}

/**
 * Get GitHub API headers with authentication
 */
export async function getGitHubHeaders() {
  const token = await getGitHubToken()
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  }
}
