/**
 * Push the current instructor prompt + tool contract to the live ElevenLabs
 * agent. The same sync runs on every POST /api/relaxation/session; this is
 * the manual version, for when you want the agent updated without starting
 * a session.
 *
 *   node scripts/sync-instructor-agent.js
 */
import 'dotenv/config'
import { scriptToolPayload, conversationConfig } from '../src/routes/relaxation.routes.js'

const API = 'https://api.elevenlabs.io/v1'
const AGENT_NAME = 'Calm — Relaxation Instructor'
const TOOL_NAME = 'get_next_line'

const key = process.env.ELEVENLABS_AGENT_API_KEY || process.env.ELEVENLABS_API_KEY
if (!key) throw new Error('No ELEVENLABS_API_KEY in backend/.env')

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'xi-api-key': key, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
}

// 1. the client tool
const toolList = await call('/convai/tools')
const tools = Array.isArray(toolList) ? toolList : toolList?.tools || []
let tool = tools.find((t) => (t?.tool_config?.name || t?.name) === TOOL_NAME)
if (!tool) {
  tool = await call('/convai/tools', {
    method: 'POST',
    body: JSON.stringify(scriptToolPayload()),
  })
  console.log('created tool', tool.id)
} else {
  await call(`/convai/tools/${encodeURIComponent(tool.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tool_config: scriptToolPayload().tool_config }),
  })
  console.log('synced tool', tool.id)
}

// 2. the agent (create it when the account has none, e.g. after a key swap)
const agentList = await call('/convai/agents')
const agents = agentList.agents || agentList
let agent = agents.find((a) => a.name === AGENT_NAME)
if (!agent) {
  agent = await call('/convai/agents/create', {
    method: 'POST',
    body: JSON.stringify({
      name: AGENT_NAME,
      conversation_config: conversationConfig(process.env.INSTRUCTOR_VOICE_ID || undefined, tool.id),
    }),
  })
  console.log('created agent', agent.agent_id)
} else {
  await call(`/convai/agents/${encodeURIComponent(agent.agent_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      conversation_config: conversationConfig(process.env.INSTRUCTOR_VOICE_ID || undefined, tool.id),
    }),
  })
  console.log('synced agent', agent.agent_id)
}
