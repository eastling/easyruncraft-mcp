import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const coordinate = z.number().min(-1000000).max(1000000);
const point = z.tuple([coordinate,coordinate]);
const modelSpace = 'layout.set {"name":"Model"}';

export const cadSchema = z.strictObject({
 file_id: idSchema,
 request_id: requestId,
 operation: z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('inspect')}),
  z.strictObject({type: z.literal('add_line'), start:point, end:point})
   .refine(({start,end}) => start[0] !== end[0] || start[1] !== end[1], 'Use distinct endpoints.'),
  z.strictObject({type: z.literal('add_circle'), center:point, radius:z.number().positive().max(100000)}),
  z.strictObject({type: z.literal('export_model'), format:z.enum(['png','pdf'])}),
 ]),
});

// CADCraft resolves Xrefs on open. Accept only text DXF, with no external drawing or image references.
function requireStandaloneDxf(path) {
 const source = readFileSync(path,'latin1');
 if (source.includes('\0') || /\r(?!\n)/.test(source)) throw new ServiceError('Upload a text DXF with LF or CRLF line endings.');
 const pair = /[ \t]*(\d{1,4})[ \t]*\r?\n([^\r\n]*)(?:\r?\n|$)/y;
 let offset = 0;
 let record = '';
 let ended = false;
 while (offset < source.length) {
  pair.lastIndex = offset;
  const match = pair.exec(source);
  if (!match) break;
  offset = pair.lastIndex;
  const code = Number(match[1]);
  if (code === 0) {
   record = match[2].trim().toUpperCase();
   if (record === 'EOF') { ended = true; break; }
   if (/^(IMAGE|IMAGEDEF|PDFUNDERLAY|DWFUNDERLAY|DGNUNDERLAY|PDFDEFINITION|DWFDEFINITION|DGNDEFINITION|POINTCLOUD.*)$/.test(record)) {
    throw new ServiceError('Export a standalone DXF without external images, underlays or point clouds.');
   }
  }
  if (record === 'BLOCK' && code === 70 && (Number(match[2].trim()) & 12)) {
   throw new ServiceError('Bind or remove external drawing references (Xrefs) before uploading.');
  }
 }
 if (!ended || source.slice(offset).trim()) throw new ServiceError('Upload a complete text DXF with valid group pairs.');
}

export async function executeCad({operation}, input, run, assertOutput, directory) {
 requireStandaloneDxf(join(directory,input));
 const read = async file => {
  const stdout = await run(['run',file,'--cmd',modelSpace,'--cmd','drawing.inspect {"entities":false}']);
  return JSON.parse(stdout.trim().split('\n').at(-1));
 };
 const before = await read(input);
 if (operation.type === 'inspect') return {result:before};
 if (operation.type === 'export_model') {
  const output = `result.${operation.format}`;
  await run(['convert',input,output,'--view','extents']);
  return {output,result:{format:operation.format,space:'model'}};
 }
 const layer = before.layers.find(item => item.name === before.currentLayer);
 if (!layer?.on || layer.frozen || layer.locked) {
  throw new ServiceError('Set an enabled, unlocked and unfrozen current layer before uploading the drawing.');
 }
 const line = operation.type === 'add_line';
 const command = line ? 'line '+JSON.stringify({points:[operation.start,operation.end]})
                      : 'circle '+JSON.stringify({center:operation.center,radius:operation.radius});
 const output = 'result.dxf';
 await run(['run',input,'--cmd',modelSpace,'--cmd',command,'--save',output]);
 assertOutput(output);
 const updated = await read(output);
 const kind = line ? 'Line' : 'Circle';
 if (updated.entityCount !== before.entityCount+1 || updated.counts[kind] !== (before.counts[kind] ?? 0)+1) {
  throw new ServiceError('The new entity could not be confirmed in the saved DXF.');
 }
 return {output,result:{entity:kind,layer:layer.name,space:'model',entity_count:updated.entityCount}};
}
