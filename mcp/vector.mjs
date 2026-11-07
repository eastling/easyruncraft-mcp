import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const coordinate = z.number().min(-100000).max(100000);
const dimension = z.number().positive().max(10000);

export const vectorSchema = z.strictObject({
 file_id: idSchema,
 request_id: requestId,
 operation: z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('inspect')}),
  z.strictObject({
   type: z.literal('add_shape'),
   shape: z.enum(['rectangle','ellipse']),
   x: coordinate, y: coordinate, width: dimension, height: dimension,
  }),
  z.strictObject({
   type: z.literal('export_artboard'),
   artboard: z.number().int().min(1).max(1000),
   format: z.enum(['png','pdf']),
  }),
 ]),
});

async function vectorSession(input, run, directory, calls) {
 const rpc = (method, params, id) => ({jsonrpc:'2.0', method, params, ...(id === undefined ? {} : {id})});
 const tools = [['open_file', {path:input}], ...calls];
 const messages = [
  rpc('initialize', {protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'easyruncraft',version:'0.1.0'}}, 1),
  rpc('notifications/initialized', {}),
  ...tools.map(([name, args], index) => rpc('tools/call', {name, arguments:args}, index+2)),
 ];
 const args = ['mcp','--headless','--automation-read-root',directory,'--automation-write-root',directory];
 const stdout = await run(args, messages.map(message => JSON.stringify(message)).join('\n')+'\n');
 const replies = new Map(stdout.trim().split('\n').map(line => {
  const reply = JSON.parse(line);
  return [reply.id, reply];
 }));
 const results = tools.map(([name], index) => {
  const reply = replies.get(index+2);
  const message = reply?.result?.content?.find(item => item.type === 'text')?.text;
  if (!message || reply.error || reply.result.isError) {
   throw new ServiceError(`VectorCraft ${name} failed: ${(reply?.error?.message ?? message ?? 'No response from the engine.').replaceAll(directory,'[workspace]').slice(0,800)}`);
  }
  return JSON.parse(message);
 });
 const [opened, ...outputs] = results;
 return {outputs, warnings:opened.warnings ?? [], missing_links:opened.missingLinks?.length ?? 0};
}

export async function executeVector({operation}, input, run, assertOutput, directory) {
 const session = calls => vectorSession(input, run, directory, calls);
 const inspect = ['inspect_document', {depth:0,childLimit:40}];
 if (operation.type === 'inspect') {
  const {outputs:[doc], warnings, missing_links} = await session([inspect]);
  const {artboards, layers, objects, colorMode, units} = doc;
  return {result:{artboards,layers,objects,color_mode:colorMode,units,warnings,missing_links}};
 }
 if (operation.type === 'add_shape') {
  const {shape,x,y,width,height} = operation;
  const output = 'result.vectorcraft';
  const {outputs:[created,saved], warnings, missing_links} = await session([
   ['run_command', {command:`shape.${shape}`, params:{x,y,width,height}}],
   ['save_file', {path:output}],
  ]);
  if (!Number.isSafeInteger(created.id)) throw new ServiceError('VectorCraft did not confirm the new shape.');
  return {output, result:{shape_id:created.id,warnings:[...warnings,...(saved.warnings ?? [])],missing_links}};
 }
 const {artboard,format} = operation;
 const {outputs:[doc]} = await session([inspect]);
 const board = doc.artboards?.[artboard-1];
 if (!board) throw new ServiceError('The selected artboard does not exist.');
 if (format === 'png' && (!(board.width > 0 && board.width <= 4096) || !(board.height > 0 && board.height <= 4096))) {
  throw new ServiceError('PNG artboards must be at most 4096 points per side at the default export scale.');
 }
 const output = `result.${format}`;
 const {outputs:[exported],warnings,missing_links} = await session([
  ['export', {path:output,format,artboard:artboard-1,scale:1}],
 ]);
 return {output, result:{format,artboard,warnings:[...warnings,...(exported.warnings ?? [])],missing_links}};
}
