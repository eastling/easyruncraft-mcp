import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const format=z.enum(['png','jpg','webp','psd']);
const dimension=z.number().int().min(1).max(4096);
const steps=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('rotate'),degrees:z.union([z.literal(90),z.literal(180),z.literal(270)])}),
 z.strictObject({type:z.literal('flip'),axis:z.enum(['horizontal','vertical'])}),
 z.strictObject({type:z.literal('resize'),width:dimension,height:dimension}),
]);

export const photoSchema=z.strictObject({
 file_id:idSchema,request_id:requestId,
 operation:z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('edit'),steps:z.array(steps).min(1).max(5),format}),
  z.strictObject({type:z.literal('convert'),format}),
 ]),
});

export async function executePhoto({operation},input,run,assertOutput) {
 const inspect=async file=>JSON.parse(await run(['info',file,'--compact']));
 const before=await inspect(input);
 if (!Number.isSafeInteger(before.width) || !Number.isSafeInteger(before.height) ||
     before.width<1 || before.height<1 || before.width*before.height>4096**2) {
  throw new ServiceError('PhotoCraft supports images of up to 16,777,216 canvas pixels.');
 }
 if (operation.type==='inspect') return {result:before};
 const output='result.'+operation.format;
 if (operation.type==='convert') {
  await run(['convert',input,output]);
 } else {
  const commands=[];
  for (const step of operation.steps) {
   if (step.type==='rotate') commands.push('--cmd','image.imageRotation.'+{90:'90cw',180:'180',270:'90ccw'}[step.degrees]);
   else if (step.type==='flip') commands.push('--cmd','image.imageRotation.'+(step.axis==='horizontal'?'flipCanvasHorizontal':'flipCanvasVertical'));
   else commands.push('--cmd','image.imageSize','--params',JSON.stringify({width:step.width,height:step.height}));
  }
  await run(['run',input,...commands,'--out',output]);
 }
 assertOutput(output);
 const result=await inspect(output);
 return {output,result};
}
