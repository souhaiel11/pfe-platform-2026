// Prépare le résultat lié à patch conversation Workflow.
import { randomUUID } from 'node:crypto';

export const fetchContextCode = `const body = $input.first()?.json?.body;
if (!body || typeof body.question !== 'string' || !body.question.trim()) {
  throw new Error('CHAT_INVALID_REQUEST');
}
const history = Array.isArray(body.history)
  ? body.history.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-5)
  : [];
return [{ json: {
  question: body.question.trim(),
  ...(typeof body.projectId === 'string' && body.projectId.trim() ? { projectId: body.projectId.trim() } : {}),
  history,
} }];`;

export const parseResponseCode = `const response = $input.first()?.json;
if (!response || !Array.isArray(response.content) || response.content.length === 0) {
  throw new Error('CHAT_INVALID_PROVIDER_RESPONSE');
}
const textBlocks = response.content.filter(block => block && block.type === 'text');
if (textBlocks.length === 0 || textBlocks.some(block => typeof block.text !== 'string' || !block.text.trim())) {
  throw new Error('CHAT_INVALID_PROVIDER_RESPONSE');
}
const answer = textBlocks.map(block => block.text.trim()).join('\\n');
return [{ json: { ok: true, answer } }];`;

export const errorResponseCode = `return [{ json: {
  ok: false,
  answer: null,
  error: { code: 'CHAT_WORKFLOW_ERROR', message: 'Unable to process the chat request.' },
} }];`;

/** Prépare le résultat lié à patch conversation Workflow. */
export function patchChatWorkflow(live) {
  if (live.id !== '6BVXqAsePEPAjiIQ' || live.name !== 'WF-Chat-V4') {
    throw new Error('Unexpected workflow identity');
  }
  const workflow = structuredClone(live);
  /** Retrouve ou construit le nœud du workflow demandé. */
  const node = name => {
    const found = workflow.nodes.find(n => n.name === name);
    if (!found) throw new Error('Missing chat node: ' + name);
    return found;
  };
  const get = node('Get Incidents');
  const header = get.parameters.headerParameters.parameters.find(h => h.name.toLowerCase() === 'x-internal-secret');
  if (!header) throw new Error('Missing internal authentication header');
  header.value = '={{ $env.N8N_INTERNAL_SECRET }}';
  get.parameters.url = "={{ 'http://backend:3001/api/incidents?size=20' + ($json.projectId ? '&projectId=' + encodeURIComponent($json.projectId) : '') }}";
  node('Fetch Context').parameters.jsCode = fetchContextCode;
  const build = node('Build Prompt');
  const oldHistory = "const history = $('Fetch Context').first().json.history || [];";
  if (!build.parameters.jsCode.includes(oldHistory) && !build.parameters.jsCode.includes('const rawHistory =')) {
    throw new Error('Unexpected Build Prompt source');
  }
  build.parameters.jsCode = build.parameters.jsCode.replace(oldHistory,
    "const rawHistory = $('Fetch Context').first().json.history;\nconst history = Array.isArray(rawHistory) ? rawHistory.filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string').slice(-5) : [];");
  node('Parse Response').parameters.jsCode = parseResponseCode;
  node('Respond to Webhook').parameters.options = {
    ...node('Respond to Webhook').parameters.options,
    responseCode: '={{ $json.ok === true ? 200 : 502 }}',
  };
  const errorName = 'Chat Error Response';
  if (!workflow.nodes.some(n => n.name === errorName)) {
    workflow.nodes.push({
      id: randomUUID(), name: errorName, type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [672, 560], parameters: { mode: 'runOnceForAllItems', jsCode: errorResponseCode },
    });
  } else if (node(errorName).type !== 'n8n-nodes-base.code') {
    throw new Error('Unexpected error node type');
  }
  node(errorName).parameters.jsCode = errorResponseCode;
  for (const name of ['Fetch Context', 'Get Incidents', 'Build Prompt', 'Prepare Claude Body', 'Get Incidents1', 'Parse Response']) {
    node(name).onError = 'continueErrorOutput';
    workflow.connections[name].main[1] = [{ node: errorName, type: 'main', index: 0 }];
  }
  workflow.connections[errorName] = { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] };
  return workflow;
}
