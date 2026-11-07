import {z} from 'zod/v4';
import {fileType} from './file-types.mjs';
import fileLimits from './file-limits.json' with {type:'json'};
export const DEFAULT_FILE_BYTES=fileLimits.trialBytes;
export const MAX_FILE_BYTES=Math.max(fileLimits.trialBytes,...Object.values(fileLimits.plans));
export const formatFileLimit=bytes=>bytes%1000000===0?`${bytes/1000000} MB`:`${bytes/1048576} MiB`;
export const idSchema=z.string().uuid();
export const rangeSchema=z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/i).refine(range=>{
 if(!/^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/i.test(range))return false;
 const parts=range.toUpperCase().split(':'),parse=part=>{const [,letters,row]=part.match(/^([A-Z]+)([0-9]+)$/);return [Number(row),[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];};const [r1,c1]=parse(parts[0]),[r2,c2]=parse(parts[1]||parts[0]);return r2>=r1&&c2>=c1&&r2<=1048576&&c2<=16384&&(r2-r1+1)*(c2-c1+1)<=10000;
},'Use a forward range of at most 10,000 cells within spreadsheet bounds.');
const sheet=z.string().min(1).max(128),cell=z.union([z.string().max(4000),z.number().finite(),z.boolean(),z.null()]);
const values=z.array(z.array(cell).min(1).max(100)).min(1).max(100).refine(rows=>rows.every(row=>row.length===rows[0].length),'Use a rectangular matrix.');
const gridOperation=z.discriminatedUnion('type',[
 z.object({type:z.literal('set_values'),sheet,cell:rangeSchema.refine(value=>!value.includes(':'),'Use one start cell.'),values}).strict().refine(op=>{const match=op.cell.toUpperCase().match(/^([A-Z]+)([0-9]+)$/);if(!match||!op.values.length||!op.values[0]?.length)return false;const [,letters,row]=match;const col=[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);return col+op.values[0].length-1<=16384&&Number(row)+op.values.length-1<=1048576;},'Values extend beyond the spreadsheet bounds.'),
 z.object({type:z.literal('format'),sheet,range:rangeSchema,bold:z.boolean().optional(),numberFormat:z.string().min(1).max(80).optional()}).strict().refine(op=>op.bold!==undefined||op.numberFormat!==undefined,'Specify bold or numberFormat.'),
 z.object({type:z.literal('sort'),sheet,range:rangeSchema,column:z.string().regex(/^[A-Z]{1,3}$/i),descending:z.boolean().default(false),header:z.boolean().default(true)}).strict(),
]);
export const gridJobSchema=z.object({file_id:idSchema,request_id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),operations:z.array(gridOperation).min(1).max(30)}).strict();
const page = z.number().int().min(1).max(10000);
const pages = z.array(page).min(1).max(100).refine(items => new Set(items).size === items.length, 'Duplicate page numbers are not allowed.');
const position = z.number().int().min(1).max(10001);
const point = z.number().min(0).max(14400);
const dimension = z.number().min(1).max(14400);
const sourcePdf = z.number().int().min(2).max(5).describe('1-based index into file_ids. Index 1 is the PDF being edited.');
const xy = z.tuple([point, point]);
const margins = z.tuple([point, point, point, point]);
const shortText = z.string().min(1).max(256);
const bodyText = z.string().min(1).max(2000);
const bookmarkPath = z.array(page).min(1).max(16);
export const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

const pdfOperation = z.discriminatedUnion('type', [
 z.strictObject({type:z.literal('rotate'),pages,degrees:z.union([z.literal(90),z.literal(180),z.literal(270)])}),
 z.strictObject({type:z.literal('extract'),pages}),
 z.strictObject({type:z.literal('delete'),pages}),
 z.strictObject({type:z.literal('move'),pages,to:position.describe('1-based destination in the document before moving the pages.')}),
 z.strictObject({type:z.literal('duplicate'),pages}),
 z.strictObject({type:z.literal('insert_blank'),at:position,width:dimension.optional(),height:dimension.optional()})
   .refine(op => (op.width === undefined) === (op.height === undefined), 'Provide both width and height, or neither.'),
 z.strictObject({type:z.literal('insert_from_pdf'),source:sourcePdf,at:position,pages:pages.optional()}),
 z.strictObject({type:z.literal('replace_from_pdf'),source:sourcePdf,pages,from_pages:pages.optional()})
   .refine(op => !op.from_pages || op.from_pages.length === op.pages.length, 'Provide a matching number of source and destination pages.'),
 z.strictObject({type:z.literal('crop'),pages,margins}),
 z.strictObject({type:z.literal('reset_crop'),pages}),
 z.strictObject({type:z.literal('page_labels'),from:page,to:page,style:z.enum(['decimal','upper-roman','lower-roman','upper-alpha','lower-alpha','none']).optional(),prefix:shortText.optional(),start:page.optional()}),
 z.strictObject({type:z.literal('set_metadata'),key:z.enum(['Title','Author','Subject','Keywords']),value:z.string().max(2000)}),
 z.strictObject({type:z.literal('add_text'),page,text:bodyText,at:xy,width:dimension.optional(),size:z.number().min(6).max(72).optional()}),
 z.strictObject({type:z.literal('replace_text_line'),page,line:page,expected_text:bodyText,text:bodyText.refine(text => !/[\r\n]/.test(text), 'Provide a single line.')}),
 z.strictObject({type:z.literal('add_bookmark'),page,title:shortText,parent:bookmarkPath.optional()}),
 z.strictObject({type:z.literal('rename_bookmark'),path:bookmarkPath,title:shortText}),
 z.strictObject({type:z.literal('retarget_bookmark'),path:bookmarkPath,page}),
 z.strictObject({type:z.literal('delete_bookmark'),path:bookmarkPath}),
 z.strictObject({type:z.literal('fill_form'),values:z.record(shortText,z.union([z.string().max(2000),z.boolean(),z.array(shortText).max(30)]))
   .refine(values => Object.keys(values).length > 0 && Object.keys(values).length <= 30, 'Provide 1 to 30 fields.')}),
 z.strictObject({type:z.literal('reset_form'),fields:z.array(shortText).min(1).max(30).optional()}),
 z.strictObject({type:z.literal('flatten'),fields:z.boolean(),comments:z.boolean()})
   .refine(op => op.fields || op.comments, 'Select forms, comments, or both.'),
 z.strictObject({type:z.literal('add_note'),page,at:xy,contents:bodyText,author:shortText.optional()}),
 z.strictObject({type:z.literal('add_watermark'),text:shortText,pages:pages.optional(),opacity:z.number().min(0).max(1).optional()}),
 z.strictObject({type:z.literal('add_header_footer'),pages:pages.optional(),header_center:shortText.optional(),footer_center:shortText.optional()})
   .refine(op => op.header_center || op.footer_center, 'Provide a header or footer.'),
 z.strictObject({type:z.literal('add_background'),color:z.string().regex(/^#[0-9a-f]{6}$/i),pages:pages.optional()}),
 z.strictObject({type:z.literal('remove_page_marks'),kind:z.enum(['header_footer','watermark','background'])}),
]);

export const pdfJobSchema = z.strictObject({
 file_ids:z.array(idSchema).min(1).max(5), request_id:requestId, operations:z.array(pdfOperation).max(20),
 merge_inputs:z.boolean().optional().describe('Defaults to merging inputs in order. Set false to use the first file as the document and the others as page sources.'),
}).refine(input => input.operations.filter(op => op.type === 'extract').length <= 1
   && (!input.operations.some(op => op.type === 'extract') || input.operations.at(-1)?.type === 'extract'),
 'Use at most one extraction, as the last operation.')
 .refine(input => !input.operations.some(op => op.type === 'replace_text_line') || (input.file_ids.length === 1 && input.operations.length === 1),
 'Submit text replacement separately on the same uploaded PDF used to read the line.')
 .refine(input => input.operations.every(op => !('source' in op) || (input.merge_inputs === false && op.source <= input.file_ids.length)),
 'Page insertion or replacement from another PDF requires merge_inputs=false and a source index within file_ids.');

export const pdfQuerySchema = z.strictObject({
 file_id:idSchema, request_id:requestId,
 query:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('search_text'),text:shortText,start_page:page.optional(),skip:z.number().int().min(0).max(10000).optional(),limit:z.number().int().min(1).max(100).optional()}),
  z.strictObject({type:z.literal('read_lines'),page}),
  z.strictObject({type:z.literal('list_bookmarks'),offset:z.number().int().min(0).max(10000).optional(),limit:z.number().int().min(1).max(100).optional()}),
  z.strictObject({type:z.literal('list_forms')}),
  z.strictObject({type:z.literal('list_links')}),
  z.strictObject({type:z.literal('list_comments'),page:page.optional()}),
 ]),
});
export const pdfExportSchema = z.strictObject({
 file_id:idSchema, request_id:requestId,
 output:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('split_every'),every:page}),
  z.strictObject({type:z.literal('split_before'),before:z.array(page.min(2)).min(1).max(19)
    .refine(items => items.every((value,i) => i === 0 || value > items[i-1]), 'Use ascending, unique split positions.')}),
  z.strictObject({type:z.literal('render_page'),page,dpi:z.number().int().min(36).max(144).optional()}),
  z.strictObject({type:z.literal('optimize')}),
 ]),
});
export const uploadSchema=z.object({name:z.string().min(1).max(120).regex(/^[^/\\\x00-\x1f]+\.[a-z0-9]+$/i).refine(name=>Boolean(fileType(name)), 'Unsupported file extension.'),bytes:z.number().int().min(1).max(MAX_FILE_BYTES)}).strict();
