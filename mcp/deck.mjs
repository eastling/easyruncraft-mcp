import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const slide=z.number().int().min(1).max(10000).describe('Slide number, starting at 1.');
const notes=z.string().max(8000).refine(text=>!/[\x00-\x08\x0b-\x1f\x7f]/.test(text),'Use plain text with LF line breaks.');
export const deckSchema=z.strictObject({
 file_id:idSchema,request_id:requestId,
 operation:z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('read_slide'),slide}),
  z.strictObject({type:z.literal('set_notes'),slide,expected_text:notes,text:notes}),
  z.strictObject({type:z.literal('render_slide'),slide}),
 ]),
});

export async function executeDeck({operation},input,run,assertOutput) {
 if (operation.type==='inspect') {
  const {slideSize,slides}=JSON.parse(await run(['info',input]));
  return {result:{slide_size:slideSize,slides:slides.map(({index,title,layout,shapes,hidden})=>({
   slide:index+1,title,layout,shape_count:shapes,hidden,
  }))}};
 }
 const index=operation.slide-1;
 const command=(id,params)=>id+'='+JSON.stringify(params);
 const readSlide=async file=>{
  const response=await run(['run','--in',file,'--cmd',command('slide.inspect',{index}),'--print']);
  const prefix='slide.inspect → ';
  const line=response.split('\n').find(line=>line.startsWith(prefix));
  if (!line) throw new ServiceError('The engine did not return the requested slide.');
  const {index:inspectedIndex,...result}=JSON.parse(line.slice(prefix.length));
  if (inspectedIndex!==index) throw new ServiceError('The requested slide could not be confirmed.');
  return {slide:operation.slide,...result};
 };
 if (operation.type==='read_slide') return {result:await readSlide(input)};
 if (operation.type==='render_slide') {
  const output='result.png';
  await run(['render',input,'--slide',String(index),'--scale','1',output]);
  return {output,result:{slide:operation.slide,format:'png'}};
 }
 const before=await readSlide(input);
 if (before.notes!==operation.expected_text) throw new ServiceError('Speaker notes did not match. Read the slide again and use the exact current notes.');
 const output='result.pptx';
 await run(['run','--in',input,'--cmd',command('slide.notes',{index,text:operation.text}),'--save',output]);
 assertOutput(output);
 const after=await readSlide(output);
 if (after.notes!==operation.text) throw new ServiceError('The new notes could not be confirmed in the saved PPTX.');
 return {output,result:{slide:after.slide,notes:after.notes}};
}
