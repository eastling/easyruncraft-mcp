import {lstatSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ServiceError} from './files.mjs';

const editCommands = {
  rotate:'page_rotate', delete:'page_delete', move:'page_move', duplicate:'page_duplicate',
  insert_blank:'page_insert_blank', crop:'page_set_box', reset_crop:'page_set_box',
  page_labels:'page_number', set_metadata:'doc_set_info', add_text:'page_add_text',
  add_bookmark:'bookmark_add', rename_bookmark:'bookmark_rename', retarget_bookmark:'bookmark_set_page',
  delete_bookmark:'bookmark_delete', fill_form:'form_fill', reset_form:'form_reset',
  flatten:'doc_flatten', add_note:'comment_add', add_watermark:'doc_watermark',
  add_header_footer:'doc_header_footer', add_background:'doc_background', remove_page_marks:'doc_remove_marks',
};
const queryCommands = {
  search_text:'text_find', read_lines:'text_lines', list_bookmarks:'bookmark_list',
  list_forms:'form_fields', list_links:'link_list', list_comments:'comment_list',
};
const command = (tool, args={}) => ({tool,args:{doc:1,...args}});

export async function executePdf(meta, inputs, dir, run, parse) {
  const open = inputs.length === 1 || meta.args.merge_inputs === false ? {tool:'doc_open',args:{path:inputs[0]}}
    : {tool:'doc_combine',args:{paths:inputs,open:true}};
  const batch = async (...steps) => {
    writeFileSync(join(dir,'steps.json'),JSON.stringify([open,...steps]),{mode:0o600});
    return parse(await run(['run','--script','steps.json','--root',dir]));
  };

  if (meta.type === 'pdf-inspect') {
    return {result:await batch(command('doc_info'), command('text_extract',{pages:meta.args.pages || [1]}))};
  }
  if (meta.type === 'pdf-query') {
    const {type,text,...args} = meta.args.query;
    if (type === 'search_text') Object.assign(args,{query:text,limit:args.limit ?? 50});
    return {result:(await batch(command(queryCommands[type],args))).at(-1)};
  }
  if (meta.type === 'pdf-export') {
    const output = meta.args.output;
    if (output.type === 'render_page') {
      await run(['render',inputs[0],'--page',String(output.page),'--dpi',String(output.dpi ?? 96),'--out','result.png']);
      return {output:'result.png',result:{page:output.page}};
    }
    if (output.type === 'optimize') {
      const result = await batch(command('doc_optimize',{path:'result.pdf'}));
      return {output:'result.pdf',result};
    }
    const [document] = await batch();
    const split = output.type === 'split_every' ? {every:output.every} : {before:output.before};
    if (split.every && Math.ceil(document.pages / split.every) > 20) {
      throw new ServiceError('This split would produce more than 20 PDFs. Choose a larger page interval.');
    }
    if (split.before?.some(page => page > document.pages)) {
      throw new ServiceError(`Choose split positions within the document’s ${document.pages} pages.`);
    }
    mkdirSync(join(dir,'parts'),{mode:0o700});
    const {files} = (await batch(command('doc_split',{...split,out_dir:'parts'}))).at(-1);
    if (!Array.isArray(files) || files.length < 1 || files.length > 20) throw new ServiceError('The split did not produce a supported set of PDFs.');
    const parts = files.map(({first_page,last_page},index) => ({
      name:`input-0-part${index+1}.pdf`, first_page, last_page,
    }));
    return {parts,result:{parts:parts.map(({first_page,last_page})=>({first_page,last_page}))}};
  }

  const steps = [];
  for (const {type,...args} of meta.args.operations) {
    if (type === 'extract') {
      steps.push(command('page_extract',{...args,out:'result.pdf',open:false}));
    } else if (type === 'replace_text_line') {
      const {page,line,expected_text,text} = args;
      const result = (await batch(command('text_lines',{page}))).at(-1);
      if (result.lines?.find(item => item.line === line)?.text !== expected_text) {
        throw new ServiceError('The selected line does not match the expected text. Read the lines again before editing.');
      }
      steps.push(command('text_edit',{page,line,text}));
    } else if (type === 'insert_from_pdf' || type === 'replace_from_pdf') {
      const {source,...selection} = args;
      const tool = type === 'insert_from_pdf' ? 'page_insert_file' : 'page_replace';
      steps.push(command(tool,{...selection,path:inputs[source-1]}));
    } else {
      if (type === 'add_note') args.type = 'note';
      if (type === 'crop' || type === 'reset_crop') args.box = 'crop';
      steps.push(command(editCommands[type],args));
    }
  }
  if (meta.args.operations.at(-1)?.type !== 'extract') steps.push(command('doc_save',{path:'result.pdf'}));
  return {output:'result.pdf',result:await batch(...steps)};
}

export function pdfArtifactSize(path) {
  let stat;
  try { stat = lstatSync(path); } catch { throw new ServiceError('The PDF engine did not produce the expected output file.'); }
  if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0) throw new ServiceError('The PDF engine produced an invalid output file.');
  return stat.size;
}
