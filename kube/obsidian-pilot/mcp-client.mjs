// Small diagnostic client for the pinned server's actual Streamable HTTP API.
// Callers must never print raw responses, tokens, notes or error payloads.
export function rpcMessage(text, id, eventStream) {
  const messages = eventStream ? text.split(/\r?\n\r?\n/).map(block =>
    block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
    .filter(Boolean).map(value => JSON.parse(value)) : [JSON.parse(text)];
  const message = messages.find(value => value.id === id);
  if (!message || message.error || !('result' in message)) throw new Error('MCP_RPC_REFUSED');
  return message.result;
}
export function contentValue(result) {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
}
export async function connectMcp(url, token) {
  let id = 0;
  let session;
  let protocol;
  async function request(body, method = 'POST') {
    return fetch(url, {method, signal: AbortSignal.timeout(30000), headers: {
      Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token, ...(session ? {'Mcp-Session-Id': session} : {}),
      ...(protocol ? {'MCP-Protocol-Version': protocol} : {}),
    }, body: body ? JSON.stringify(body) : undefined});
  }
  async function rpc(method, params) {
    const current = ++id;
    const response = await request({jsonrpc: '2.0', id: current, method, ...(params ? {params} : {})});
    if (response.status !== 200) throw new Error('MCP_HTTP_REFUSED');
    session ||= response.headers.get('mcp-session-id');
    return rpcMessage(await response.text(), current, response.headers.get('content-type')?.includes('text/event-stream'));
  }
  const initialized = await rpc('initialize', {protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: {name: 'disposable-pilot-qualification', version: '1'}});
  protocol = initialized.protocolVersion;
  if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(protocol)) throw new Error('MCP_INITIALIZE_REFUSED');
  const response = await request({jsonrpc: '2.0', method: 'notifications/initialized'});
  if (![200, 202, 204].includes(response.status)) throw new Error('MCP_NOTIFICATION_REFUSED');
  return {
    async tools() { return (await rpc('tools/list')).tools; },
    async call(name, args, expectedError = false) {
      const result = await rpc('tools/call', {name, arguments: args});
      if (!!result.isError !== expectedError) throw new Error('MCP_TOOL_EXPECTATION_FAILED');
      return contentValue(result);
    },
    async close() { const result = await request(undefined, 'DELETE');
      if (![200, 202, 204].includes(result.status)) throw new Error('MCP_SESSION_CLOSE_REFUSED'); },
  };
}
