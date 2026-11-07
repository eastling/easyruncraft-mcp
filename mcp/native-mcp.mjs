import {ServiceError} from './files.mjs';

// Send only the fixed tool calls assembled by the editor adapter.
export async function callNativeTools(run, args, directory, engine, calls) {
 const rpc = (method, params, id) => ({jsonrpc:'2.0', method, params, ...(id === undefined ? {} : {id})});
 const messages = [
  rpc('initialize', {protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'easyruncraft',version:'0.1.0'}}, 1),
  rpc('notifications/initialized', {}),
  ...calls.map(([name, input], index) => rpc('tools/call', {name, arguments:input}, index+2)),
 ];
 const stdout = await run(args, messages.map(message => JSON.stringify(message)).join('\n')+'\n');
 const replies = new Map(stdout.trim().split('\n').map(line => {
  const reply = JSON.parse(line);
  return [reply.id, reply];
 }));
 return calls.map(([name], index) => {
  const reply = replies.get(index+2);
  const message = reply?.result?.content?.find(item => item.type === 'text')?.text;
  if (!message || reply.error || reply.result.isError) {
   const detail = (reply?.error?.message ?? message ?? 'No response from the engine.').replaceAll(directory,'[workspace]').slice(0,800);
   throw new ServiceError(`${engine} ${name} failed: ${detail}`);
  }
  return JSON.parse(message);
 });
}
