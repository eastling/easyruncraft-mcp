import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const controls = [
 ['exposure','light.exposure'],
 ['contrast','light.contrast'],
 ['saturation','color.saturation'],
];
export const lightSchema = z.strictObject({
 file_id:idSchema, request_id:requestId,
 operation:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('develop'), format:z.enum(['jpg','png','webp']),
   long_edge:z.number().int().min(64).max(3072).default(1600),
   exposure:z.number().min(-5).max(5).optional(),
   contrast:z.number().min(-100).max(100).optional(),
   saturation:z.number().min(-100).max(100).optional()}),
 ]),
});

export async function executeLight({operation}, input, run) {
 const response = JSON.parse((await run(['run','--import',input,'photo.inspect'])).trim());
 if (!response.ok || !response.result) throw new ServiceError('LightCraft could not inspect this photo.');
 const {width,height,format,develop} = response.result;
 if (operation.type==='inspect') return {result:{width,height,format,develop}};
 if (!(width>0 && height>0 && width*height<=40_000_000)) {
  throw new ServiceError('Use a photo of at most 40 megapixels.');
 }
 const output=`result.${operation.format}`;
 const args=['render',input,'-o',output,'--size',String(operation.long_edge)];
 for (const [field,control] of controls) {
  if (operation[field]!==undefined) args.push('--set',control+'='+operation[field]);
 }
 await run(args);
 return {output,result:{format:operation.format,max_long_edge:operation.long_edge}};
}
