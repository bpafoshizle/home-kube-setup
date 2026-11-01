import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcMessage, contentValue} from './mcp-client.mjs';
test('JSON and SSE results are decoded without emitting raw payloads', () => {
  assert.deepEqual(rpcMessage('{"id":1,"result":{"ok":true}}', 1, false), {ok:true});
  assert.deepEqual(rpcMessage('event: message\ndata: {"id":1,"result":[]}\n\n', 1, true), []);
});
test('unrelated notifications do not replace the matching response', () => {
  assert.equal(rpcMessage('data: {"method":"notice"}\n\ndata: {"id":2,"result":42}\n\n', 2, true), 42);
});
test('server errors are replaced by a fixed diagnostic', () => {
  assert.throws(() => rpcMessage('{"id":1,"error":{"message":"private payload"}}', 1, false), /^Error: MCP_RPC_REFUSED$/);
});
test('structured and text tool results retain data privately for assertions', () => {
  assert.deepEqual(contentValue({structuredContent:{ok:true}}), {ok:true});
  assert.deepEqual(contentValue({content:[{type:'text',text:'[]'}]}), []);
  assert.equal(contentValue({content:[{type:'text',text:'synthetic fixture'}]}), 'synthetic fixture');
});
