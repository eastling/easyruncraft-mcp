import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {createWriteStream, readFileSync, existsSync, realpathSync, statSync} from 'node:fs';
import {mkdir, readFile, writeFile, rename, rm, appendFile, symlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {ServiceError} from './files.mjs';

export const runtimeContract = 1;
export const runtimeSlugs = ['photo','light','vector','fig','design','film','effect','sound','pdf','word','grid','deck','cad'];
const hash = value => createHash('sha256').update(value).digest('hex');
const revisionPattern = /^[a-f0-9]{64}$/;
export function currentRuntimes(root) {
  try {return JSON.parse(readFileSync(join(root, 'current.json'), 'utf8'));}
  catch (error) {if (error.code === 'ENOENT') return {schema:1, revision:null, editors:{}, history:[]}; throw error;}
}

/** Resolve once at submission. Every invocation within this job uses this immutable path. */
export function nativeRuntime(root, slug, fallbackRoot) {
  if (root) {
    const pin = currentRuntimes(root).editors[slug]?.native;
    if (!pin || !revisionPattern.test(pin.revision) || pin.contract !== runtimeContract) throw new ServiceError('The native engine is not installed.',503);
    const binary = join(resolve(root), 'native/releases', slug, pin.revision, slug+'craft-cli');
    if (!existsSync(binary) || !statSync(binary).isFile()) throw new ServiceError('The native engine is unavailable.',503);
    return {binary:realpathSync(binary), revision:pin.revision, version:pin.version};
  }
  let binary;
  try {binary=realpathSync(join(fallbackRoot,slug+'craft-cli'));}
  catch {throw new ServiceError('Install the pinned native runtimes before submitting tasks.',503);}
  return {binary, revision:'development', version:'development'};
}

async function atomicJson(path, value) {
  const temporary = path+'.'+randomUUID();
  await writeFile(temporary, JSON.stringify(value)+'\n', {mode:0o644, flush:true});
  await rename(temporary,path);
}

/** Caller serializes activation. One current.json switches browser, metadata and native pins together. */
export async function activateRuntimes(root, {expectedRevision, changes}) {
  const previous = currentRuntimes(root);
  if (previous.revision !== expectedRevision) throw new ServiceError('Runtime versions changed; refresh the release plan.',409);
  if (!Array.isArray(changes) || !changes.length || changes.length > 26) throw new ServiceError('Choose runtime revisions to activate.');
  const editors = structuredClone(previous.editors), events = [], unique = new Set();
  for (const {kind,slug,revision} of changes) {
    if (!['browser','native'].includes(kind) || !runtimeSlugs.includes(slug) || !revisionPattern.test(revision) || unique.has(kind+slug)) throw new ServiceError('Invalid runtime selection.');
    unique.add(kind+slug);
    const manifest = JSON.parse(await readFile(join(root,kind,'releases',slug,revision,'manifest.json'),'utf8'));
    if (manifest.contract !== runtimeContract || manifest.revision !== revision || manifest.kind !== kind || manifest.slug !== slug) throw new ServiceError('Runtime contract is incompatible.',409);
    const {files,...pin} = manifest;
    if (kind === 'browser') {
      const prefix = `/runtimes/releases/${slug}/${revision}/`;
      pin.entry = prefix+manifest.entry;
      pin.preloads = (manifest.preloads||[]).map(item=>({...item,href:prefix+item.href}));
    }
    if (editors[slug]?.[kind]?.revision === revision) continue;
    editors[slug] = {...editors[slug],[kind]:pin};
    events.push({slug,kind,version:pin.version,revision,releaseUrl:pin.releaseUrl,notes:pin.notes||''});
  }
  if (!events.length) return previous;
  const at = new Date().toISOString(), revision = hash(JSON.stringify(editors));
  const next = {schema:1,revision,editors,history:[{at,revision,changes:events},...(previous.history||[])].slice(0,100)};
  if(!previous.revision){
    // Retain the initial asset addresses for editor tabs opened before the one-time migration.
    // These links never advance. New tabs use the immutable entry in current.json.
    await mkdir(join(root,'initial-assets'),{recursive:true,mode:0o755});
    for(const [slug,pins] of Object.entries(editors))if(pins.browser){
      try{await symlink(`../browser/releases/${slug}/${pins.browser.revision}`,join(root,'initial-assets',slug));}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await mkdir(join(root,'snapshots'),{recursive:true,mode:0o755});
  if (previous.revision) await atomicJson(join(root,'snapshots',previous.revision+'.json'),previous);
  await atomicJson(join(root,'current.json'),next);
  await appendFile(join(root,'releases.jsonl'),JSON.stringify({at,revision,previousRevision:previous.revision,changes:events})+'\n');
  return next;
}

export function runtimeReleaseHandler(root, secret) {
  let busy = false;
  return async (req,res,url) => {
    // This private path is also proxied by the previously deployed web gateway during initial migration.
    if(url.pathname.startsWith('/mcp-files/runtime-releases/'))url=new URL(url.href.replace('/mcp-files/runtime-releases/','/_runtime-release/'));
    if (!url.pathname.startsWith('/_runtime-release/')) return false;
    const reply = (status, data) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
    const expected = Buffer.from('Bearer '+(secret||'')), received = Buffer.from(req.headers.authorization||'');
    if (!root || !secret || secret.length < 32 || received.length !== expected.length || !timingSafeEqual(received,expected)) {reply(401,{error:'Release authorization required.'});return true;}
    if (req.method === 'GET' && url.pathname === '/_runtime-release/status') {reply(200,{...currentRuntimes(root),contract:runtimeContract});return true;}
    if (busy) {reply(409,{error:'Another runtime release is in progress.'});return true;}
    busy = true;
    let upload,partial=false;
    try {
      const match = url.pathname.match(/^\/_runtime-release\/install\/(browser|native)\/([a-z]+)\/([a-f0-9]{64})$/);
      if (req.method === 'PUT' && match && runtimeSlugs.includes(match[2])) {
        const checksum = req.headers['x-runtime-sha256'];
        const bytes = Number(req.headers['content-length']);
        const total=Number(url.searchParams.get('total')||bytes),offset=Number(url.searchParams.get('offset')||0);
        if (!revisionPattern.test(checksum||'') || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 32*1024*1024 || !Number.isSafeInteger(total) || total<bytes || total>512*1024*1024 || !Number.isSafeInteger(offset) || offset<0 || offset+bytes>total) throw new ServiceError('Invalid runtime package size or checksum.',413);
        await mkdir(join(root,'.uploads'),{recursive:true,mode:0o700});
        upload = join(root,'.uploads',match.slice(1).join('-')+'.tar.gz');
        if(offset===0)await writeFile(upload+'.json',JSON.stringify({checksum,total}),{mode:0o600});
        else{
          const state=JSON.parse(await readFile(upload+'.json','utf8'));
          if(state.checksum!==checksum||state.total!==total||statSync(upload).size!==offset)throw new ServiceError('Runtime upload offset differs; restart the package upload.',409);
        }
        let count = 0;
        const limiter = new Transform({transform(chunk,_encoding,done){count+=chunk.length;if(count>bytes)return done(new ServiceError('Runtime upload exceeds declared size.',413));done(null,chunk);}});
        await pipeline(req,limiter,createWriteStream(upload,{flags:offset===0?'w':'a',mode:0o600}));
        if (count !== bytes) throw new ServiceError('Runtime upload size mismatch.');
        if(offset+count<total){partial=true;reply(202,{received:offset+count});return true;}
        const pin = await new Promise((yes,no)=>{
          const child=spawn('python3',[new URL('./runtime_package.py',import.meta.url).pathname,upload,root,checksum,...(match[1]==='native'?['--smoke']:[])],{stdio:['ignore','pipe','pipe']});
          let output='';child.stdout.on('data',chunk=>{if(output.length<2*1024*1024)output+=chunk;});child.stderr.resume();
          const timer=setTimeout(()=>child.kill('SIGKILL'),180000);
          child.on('error',()=>{clearTimeout(timer);no(new ServiceError('Runtime installer could not start.',503));});
          child.on('close',code=>{clearTimeout(timer);if(code!==0)return no(new ServiceError('Runtime package validation failed.'));try{yes(JSON.parse(output));}catch{no(new ServiceError('Invalid runtime installer result.'));}});
        });
        if (pin.kind !== match[1] || pin.slug !== match[2] || pin.revision !== match[3]) throw new ServiceError('Uploaded package differs from selected revision.');
        reply(201,pin);
      } else if (req.method === 'POST' && url.pathname === '/_runtime-release/activate') {
        let data='';for await (const chunk of req){data+=chunk;if(Buffer.byteLength(data)>32768)throw new ServiceError('Activation is too large.',413);}
        reply(200,await activateRuntimes(root,JSON.parse(data)));
      } else reply(404,{error:'Release operation not found.'});
    } catch(error) {if(!res.headersSent)reply(error instanceof ServiceError?error.status:400,{error:error instanceof ServiceError?error.message:'Runtime release could not be completed.'});}
    finally {try{if(upload&&!partial){await rm(upload,{force:true});await rm(upload+'.json',{force:true});}}finally{busy=false;}}
    return true;
  };
}
