import {join} from 'node:path';
import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {callNativeTools} from './native-mcp.mjs';
import {idSchema,requestId} from './schemas.mjs';

const time=z.number().min(0).max(600);
const comp=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional();
export const effectSchema=z.strictObject({
 file_id:idSchema, request_id:requestId,
 operation:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('add_text'),text:z.string().min(1).max(1000).refine(text=>!text.includes('\0'),'Use plain text.'),
   size:z.number().min(6).max(144).default(32)}),
  z.strictObject({type:z.literal('render_frame'), comp, seconds:time, max_side:z.number().int().min(128).max(1280).default(960)}),
  z.strictObject({type:z.literal('render_video'), comp, start:time, end:time})
   .refine(({start,end})=>end>start && end-start<=5,'Choose a range up to five seconds.'),
 ]),
});

export async function executeEffect({operation}, input, run, _assertOutput, directory) {
 const args=['mcp','--automation-read-root',directory,'--automation-write-root',directory];
 const session = calls => callNativeTools(run,args,directory,'EffectCraft',[
  ['open_project',{path:join(directory,input)}],...calls,
 ]);
 const command=(id,params={})=>['execute_command',{command:id,params}];
 const [project,queue]=await session(operation.type==='render_video'?[command('renderQueue.list')]:[]);
 if (operation.type==='inspect') return {result:project};
 const id=operation.comp ?? project.activeComp;
 const composition=project.items.find(item=>item.id===id && item.type==='Composition');
 if (!composition) throw new ServiceError('Choose an existing composition from inspection.');
 if (operation.type==='add_text') {
  const output='result.ecproj';
  const [,layer]=await session([command('layer.newText',{text:operation.text,size:operation.size}),
   ['save_project',{path:join(directory,output)}]]);
  if (!Number.isSafeInteger(layer.layer)) throw new ServiceError('EffectCraft did not confirm the new text layer.');
  return {output,result:{comp:id,layer:layer.layer}};
 }
 if (project.items.some(item=>item.type==='Footage' && item.path)) {
  throw new ServiceError('Remove file-backed footage before rendering a hosted composition.');
 }
 if (operation.type==='render_frame') {
  if (operation.seconds>=composition.duration) throw new ServiceError('The frame time is outside the composition.');
  const output='result.png';
  const [,frame]=await session([['render_frame',{comp:id,time:operation.seconds,max_side:operation.max_side,
   inline:false,path:join(directory,output)}]]);
  return {output,result:frame};
 }
 if (operation.end>composition.duration) throw new ServiceError('The requested range extends beyond the composition.');
 if (queue?.items?.length!==0) throw new ServiceError('Empty the project render queue before uploading.');
 if (!(Math.max(...composition.size)<=1920 && Math.min(...composition.size)<=1080)) {
  throw new ServiceError('MP4 rendering supports compositions up to 1920 by 1080 pixels.');
 }
 const output='result.mp4';
 const [,,rendered]=await session([
  command('renderQueue.add',{comp:id,format:'h264',output:join(directory,output),timeSpan:'custom',
   start:operation.start,end:operation.end,frameRate:12,resolution:'half',audio:'off'}),
  command('renderQueue.render',{wait:true}),
 ]);
 if (rendered.failed!==0 || rendered.items?.length!==1) throw new ServiceError('EffectCraft could not finish the video render.');
 return {output,result:{comp:id,start:operation.start,end:operation.end,format:'mp4',audio:false}};
}
