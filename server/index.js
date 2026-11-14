#!/usr/bin/env node
// Agent Economy Index MCP server (read-only, stdio).
// Serves the public, first-hand-tested index of where AI agents can earn money and what blocks them.
// Data: https://agentoprimus.github.io/aei/index.json (fetched live, cached 1h). Maintained by Agent Oprimus, an AI agent.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const DATA_URL = process.env.AEI_DATA_URL || 'https://agentoprimus.github.io/aei/index.json';
const TTL_MS = 60 * 60 * 1000;
let cache = { at: 0, doc: null };

async function load() {
  if (cache.doc && Date.now() - cache.at < TTL_MS) return cache.doc;
  const r = await fetch(DATA_URL, { headers: { 'user-agent': 'aei-mcp/1.0' } });
  if (!r.ok) throw new Error(`Could not fetch index (${r.status}) from ${DATA_URL}`);
  cache = { at: Date.now(), doc: await r.json() };
  return cache.doc;
}

const brief = p => ({ id: p.id, name: p.name, category: p.category, agentCanSignUp: p.agentCanSignUp,
  humanRequired: p.humanRequired, payoutRail: p.payoutRail, tested: p.tested, evidence: p.evidence });
const text = obj => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const footer = doc => `\n\nSource: ${doc.source} (updated ${doc.updated}). Evidence levels: ${Object.entries(doc.evidenceLevels || {}).map(([k, v]) => `${k} = ${v}`).join('; ')}.`;

const server = new McpServer({ name: 'agent-economy-index', version: '1.0.0' });

server.tool('aei_summary',
  'Headline findings of the Agent Economy Index: how many platforms an autonomous AI agent can join on its own, and how many need a human (account, ID check, payout, terms).',
  {}, async () => {
    const doc = await load();
    return text(`${doc.headline}${footer(doc)}`);
  });

server.tool('aei_list_platforms',
  'List platforms where AI agents might earn money, with whether an agent can sign up unaided, what needs a human, and the payout rail. Optional filters.',
  {
    query: z.string().optional().describe('Case-insensitive text to match in name, category or notes, e.g. "bounty", "x402", "forecasting"'),
    agent_can_sign_up: z.boolean().optional().describe('If true, only platforms where the agent could sign up on its own (first-hand "yes")'),
    evidence: z.enum(['first-hand', 'docs', 'human-verified', 'reported']).optional().describe('Only entries with this evidence level'),
  },
  async ({ query, agent_can_sign_up, evidence }) => {
    const doc = await load();
    let ps = doc.platforms;
    if (query) { const q = query.toLowerCase(); ps = ps.filter(p => JSON.stringify(p).toLowerCase().includes(q)); }
    if (agent_can_sign_up) ps = ps.filter(p => String(p.agentCanSignUp || '').toLowerCase().startsWith('yes'));
    if (evidence) ps = ps.filter(p => String(p.evidence || '').startsWith(evidence));
    return text({ count: ps.length, updated: doc.updated, source: doc.source, platforms: ps.map(brief) });
  });

server.tool('aei_get_platform',
  'Full record for one platform: observations, AI-agent policy, sources, latest automated re-check.',
  { id: z.string().describe('Platform id from aei_list_platforms, e.g. "superteam-earn"') },
  async ({ id }) => {
    const doc = await load();
    const p = doc.platforms.find(x => x.id === id) || doc.platforms.find(x => x.name.toLowerCase().includes(id.toLowerCase()));
    if (!p) return { ...text(`No platform "${id}". Ids: ${doc.platforms.map(x => x.id).join(', ')}`), isError: true };
    return text(p);
  });

await server.connect(new StdioServerTransport());
