import {extname} from 'node:path';

const types = {
 '.pdf': ['pdf', 'application/pdf'],
 '.xlsx': ['grid', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
 '.csv': ['grid', 'text/csv'],
 '.png': ['photo', 'image/png'],
 '.jpg': ['photo', 'image/jpeg'],
 '.jpeg': ['photo', 'image/jpeg'],
 '.webp': ['photo', 'image/webp'],
 '.docx': ['word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 '.pptx': ['deck', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
 '.vectorcraft': ['vector', 'application/octet-stream'],
 '.figcraft': ['fig', 'application/octet-stream'],
 '.dxf': ['cad', 'application/dxf'],
 '.designcraft': ['design', 'application/octet-stream'],
 '.dng': ['light', 'image/x-adobe-dng'],
 '.wav': ['sound', 'audio/wav'],
 '.flac': ['sound', 'audio/flac'],
 '.mp3': ['sound', 'audio/mpeg'],
 '.mp4': ['film', 'video/mp4'],
 '.mov': ['film', 'video/quicktime'],
 '.ecproj': ['effect', 'application/octet-stream'],
 '.psd': ['photo', 'image/vnd.adobe.photoshop'],
};
export const fileType = name => types[extname(name).toLowerCase()]?.[0];
export function supportsEditor(name, editor) {
 const extension=extname(name).toLowerCase();
 return types[extension]?.[0]===editor ||
  (editor==='light' && ['.png','.jpg','.jpeg','.webp'].includes(extension));
}

export const contentType = name => types[extname(name).toLowerCase()]?.[1];
export const uploadFormats = Object.keys(types).map(ext => ext.slice(1).toUpperCase()).join(', ');

// These signatures reject mislabeled uploads before passing bytes to a native parser.
export function matchesFileType(name, data) {
 switch (extname(name).toLowerCase()) {
  case '.pdf': return data.subarray(0,1024).includes(Buffer.from('%PDF-'));
  case '.xlsx': case '.docx': case '.pptx': case '.figcraft': case '.designcraft': return data.subarray(0,4).equals(Buffer.from('504b0304','hex'));
  case '.png': return data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  case '.jpg': case '.jpeg': return data.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
  case '.webp': return data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WEBP';
  case '.psd': return data.subarray(0,6).equals(Buffer.from('384250530001','hex'));
  case '.vectorcraft': return data.subarray(0,2).equals(Buffer.from('1f8b','hex')) ||
   data.toString('utf8',0,1024).trimStart().startsWith('{');
  case '.dxf': return /^[ \t]*0[ \t]*\r?\n[ \t]*SECTION[ \t]*\r?\n/i.test(data.toString('latin1',0,1024)) ||
   /^[ \t]*999[ \t]*\r?\n/.test(data.toString('latin1',0,1024));
  case '.dng': return ['49492a00','4d4d002a'].includes(data.subarray(0,4).toString('hex'));
  case '.wav': return ['RIFF','RF64'].includes(data.toString('ascii',0,4)) && data.toString('ascii',8,12)==='WAVE';
  case '.flac': return data.toString('ascii',0,4)==='fLaC';
  case '.mp3': return data.toString('ascii',0,3)==='ID3' || (data[0]===0xff && (data[1]&0xe0)===0xe0);
  case '.mp4': case '.mov': return data.toString('ascii',4,8)==='ftyp';
  case '.ecproj': return data.toString('utf8',0,1024).trimStart().startsWith('{');
  case '.csv': return true;
  default: return false;
 }
}
