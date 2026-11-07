import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const paragraphText=z.string().min(1).max(2000).refine(text=>text.trim().length>0 && !/[\x00-\x1f\x7f]/.test(text),'Provide one nonempty plain-text paragraph.');
export const wordSchema=z.strictObject({
 file_id:idSchema,request_id:requestId,
 operation:z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('read_paragraphs'),start_block:z.number().int().min(0).max(100000).optional(),limit:z.number().int().min(1).max(40).optional()}),
  z.strictObject({type:z.literal('append_paragraph'),text:paragraphText}),
  z.strictObject({type:z.literal('export_pdf')}),
 ]),
});

export async function executeWord({operation},input,run,assertOutput) {
 const inspect=async (file,command)=>JSON.parse(await run([command,file]));
 if (operation.type==='inspect') {
  const {pages,words,paragraphs,sections,comments,properties,trackChanges}=await inspect(input,'info');
  return {result:{pages,words,paragraphs,sections,comments,properties,track_changes:trackChanges}};
 }
 if (operation.type==='export_pdf') {
  const {pages}=await inspect(input,'info');
  if (!Number.isInteger(pages)||pages<1||pages>100) throw new ServiceError('WordCraft can export documents with 1 to 100 pages.');
  const output='result.pdf';
  await run(['convert',input,output]);
  return {output,result:{format:'pdf'}};
 }
 const doc=await inspect(input,'inspect');
 if (operation.type==='read_paragraphs') {
  const start=operation.start_block??0,limit=operation.limit??20;
  const blocks=doc.blocks.slice(start,start+limit).map(({index,type,style,text})=>({
   index,type,...(style===undefined?{}:{style}),
   ...(typeof text==='string'?{text:text.slice(0,2000),truncated:text.length>2000}:{}),
  }));
  const next=start+blocks.length;
  return {result:{blocks,total_blocks:doc.blocks.length,next_start_block:next<doc.blocks.length?next:null}};
 }
 if (doc.trackChanges!==false || doc.blocks.at(-1)?.type!=='paragraph') {
  throw new ServiceError('Appending requires a final body paragraph and Track Changes turned off.');
 }
 const output='result.docx';
 await run(['run','--file',input,'--cmd','caret.docEnd','--cmd','text.newParagraph',
  '--cmd','text.insert='+JSON.stringify({text:operation.text}),'--save',output]);
 assertOutput(output);
 const updated=await inspect(output,'inspect');
 const paragraph=updated.blocks.at(-1);
 if (updated.blocks.length!==doc.blocks.length+1 || paragraph?.type!=='paragraph' || paragraph.text!==operation.text) {
  throw new ServiceError('The appended paragraph could not be confirmed in the saved DOCX.');
 }
 return {output,result:{block:paragraph.index,text:paragraph.text}};
}
