import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const pageNumber = z.number().int().min(1).max(1000).describe('Page number, starting at 1.');
const nodeId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().min(-100000).max(100000);
const dimension = z.number().positive().max(4096);

export const figSchema = z.strictObject({
 file_id: idSchema,
 request_id: requestId,
 operation: z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('inspect')}),
  z.strictObject({
   type: z.literal('add_rectangle'), page: pageNumber,
   x: coordinate, y: coordinate, width: dimension, height: dimension,
  }),
  z.strictObject({type: z.literal('render_frame'), page: pageNumber, frame_id: nodeId}),
  z.strictObject({type: z.literal('export_page_pdf'), page: pageNumber}),
 ]),
});

export async function executeFig({operation}, input, run, assertOutput, directory) {
 const read = async file => JSON.parse(await run(['info',file,'--json']));
 const {name,nodes,pages,styles,variables,images,notes} = await read(input);
 if (operation.type === 'inspect') {
  return {result:{name,nodes,pages:pages.map((page,index) => ({page:index+1,...page})),styles,variables,images,notes}};
 }
 const page = pages[operation.page-1];
 if (!page) throw new ServiceError('The selected page does not exist.');
 if (operation.type === 'add_rectangle') {
  const {x,y,width,height} = operation;
  if (!Number.isSafeInteger(page.id)) throw new ServiceError('The selected page has an unsupported ID.');
  const script = 'fig-steps.json';
  const output = 'result.figcraft';
  const steps = [{command:'shape.rectangle',params:{parent:page.id,x,y,width,height}}];
  writeFileSync(join(directory,script), JSON.stringify(steps), {flag:'wx',mode:0o600});
  const stdout = await run(['run',script,'--in',input,'--out',output]);
  const step = JSON.parse(stdout.trim().split('\n')[0]);
  assertOutput(output);
  const saved = (await read(output)).pages.find(savedPage => savedPage.id === page.id);
  if (!step.ok || !Number.isSafeInteger(step.result?.id) || saved?.topLevel !== page.topLevel+1) {
   throw new ServiceError('The new rectangle could not be confirmed in the saved design.');
  }
  return {output,result:{page:operation.page,node_id:step.result.id}};
 }

 // The upstream exporter selects pages by name. Reject ambiguous names rather than export the wrong page.
 if (pages.filter(item => item.name === page.name).length !== 1) {
  throw new ServiceError('Rename duplicate pages before exporting.');
 }
 if (operation.type === 'export_page_pdf') {
  const output = 'result.pdf';
  await run(['export',input,'-o',output,'--page',page.name]);
  return {output,result:{page:operation.page,format:'pdf'}};
 }
 const frame = page.frames.find(item => item.id === operation.frame_id && item.type === 'FRAME');
 if (!frame) throw new ServiceError('Choose a top-level frame ID from the selected page.');
 if (!(frame.width > 0 && frame.width <= 4096) || !(frame.height > 0 && frame.height <= 4096)) {
  throw new ServiceError('PNG frames must be at most 4096 pixels per side.');
 }
 const output = 'result.png';
 await run(['export',input,'-o',output,'--page',page.name,'--node',String(frame.id),'--scale','1']);
 return {output,result:{page:operation.page,frame_id:frame.id,format:'png'}};
}
