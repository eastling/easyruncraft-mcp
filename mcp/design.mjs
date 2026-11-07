import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const page = z.number().int().min(1).max(1000);
const point = z.number().min(-15000).max(15000);
export const designSchema = z.strictObject({
 file_id:idSchema, request_id:requestId,
 operation:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('add_text_frame'), spread:z.number().int().min(1).max(1000),
   rect:z.tuple([point,point,point,point]).refine(([x0,y0,x1,y1]) => x1>x0 && y1>y0,'Use [left, top, right, bottom] with positive area.'),
   text:z.string().min(1).max(2000).refine(text=>!text.includes('\0'),'Use plain text.')}),
  z.strictObject({type:z.literal('export_pdf'), pages:z.array(page).min(1).max(20)
   .refine(items=>new Set(items).size===items.length,'Choose distinct page numbers.')}),
 ]),
});

export async function executeDesign({operation}, input, run, assertOutput, _directory, readZipEntry) {
 const mimetype = await readZipEntry('mimetype');
 if (mimetype !== 'application/vnd.designcraft+zip') throw new ServiceError('Upload a native DesignCraft package.');
 const document = JSON.parse(await readZipEntry('document.json'));
 const merge = document.dataMerge ?? document.data_merge;
 if (merge?.sources?.length || Object.values(document.assets ?? {}).some(asset => asset?.link)) {
  throw new ServiceError('Embed placed assets and remove data merge sources before uploading.');
 }
 const inspect = async file => JSON.parse(await run(['run','--in',file,'--cmd','document.inspect']));
 const doc = await inspect(input);
 if (operation.type==='inspect') {
  const {title,pageCount,spreads,layers} = doc;
  return {result:{title,page_count:pageCount,spreads,layers}};
 }
 if (operation.type==='export_pdf') {
  if (operation.pages.some(page => page>doc.pageCount)) throw new ServiceError('A selected page does not exist.');
  const output='result.pdf';
  const report=JSON.parse(await run(['script','-','--in',input],
   'file.exportPdf '+JSON.stringify({path:output,pages:operation.pages})+'\n'));
  return {output,result:{pages:report.results[0].pages,warnings:report.results[0].warnings}};
 }
 if (!doc.spreads[operation.spread-1]) throw new ServiceError('The selected spread does not exist.');
 const output='result.designcraft';
 const step='frame.create '+JSON.stringify({spread:operation.spread-1,rect:operation.rect,content:'text',text:operation.text});
 const report=JSON.parse(await run(['script','-','--in',input,'--save',output],step+'\n'));
 assertOutput(output);
 const frame=report.results?.[0]?.id;
 if (!Number.isSafeInteger(frame)) throw new ServiceError('DesignCraft did not confirm the new text frame.');
 return {output,result:{frame_id:frame,spread:operation.spread}};
}
