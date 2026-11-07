import storagePolicy from './storage-policy.json' with {type:'json'};
export const RETENTION_MS=storagePolicy.retentionHours*60*60*1000;
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync,rmSync,statSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {DEFAULT_FILE_BYTES,MAX_FILE_BYTES,formatFileLimit} from './schemas.mjs';
import {supportsEditor,matchesFileType} from './file-types.mjs';
export class ServiceError extends Error{constructor(message,status=400,code){super(message);this.status=status;this.code=code;}}
const activeJob=meta=>meta.kind==='job'&&['reserving','queued','running'].includes(meta.status);
const unavailable=()=>new ServiceError('This temporary file or task is no longer available. It may have expired after 2 hours without file activity or been deleted. Continue by uploading the latest saved edited copy, not the original file.',404,'FILE_UNAVAILABLE');
export class FileStore{
 constructor(root,origin){this.root=resolve(root);this.origin=origin;this.holds=new Map();mkdirSync(this.root,{recursive:true,mode:0o700});const secretPath=join(this.root,'secret');if(!existsSync(secretPath))writeFileSync(secretPath,randomBytes(32),{mode:0o600,flag:'wx'});this.secret=readFileSync(secretPath);this.migrateRetention();}
 directory(id){if(!/^[a-f0-9-]{36}$/.test(id))throw new ServiceError('Not found.',404);return join(this.root,id);}
 migrateRetention(){
  const now=Date.now();
  for(const id of readdirSync(this.root)){
   if(!/^[a-f0-9-]{36}$/.test(id))continue;
   const path=join(this.directory(id),'meta.json');if(!existsSync(path))continue;
   let meta;try{meta=JSON.parse(readFileSync(path,'utf8'));}catch{continue;}
   if(Number.isFinite(meta.lastActivityAt))continue;
   // Give still-live legacy files one idle window at rollout; never revive expired files.
   const live=meta.expiresAt>now&&meta.status!=='deleted';
   meta.lastActivityAt=live?now:Math.min(meta.createdAt,meta.expiresAt-RETENTION_MS);
   meta.expiresAt=meta.lastActivityAt+RETENTION_MS;
   this.write(meta);
  }
 }
 read(id,owner,allowExpired=false){
  let meta;
  try{meta=JSON.parse(readFileSync(join(this.directory(id),'meta.json'),'utf8'));}catch{throw unavailable();}
  if(owner&&meta.owner!==owner)throw unavailable();
  meta.expiresAt=(meta.lastActivityAt??meta.createdAt)+RETENTION_MS;
  if(meta.sourceJob&&meta.status!=='deleted'){
   let source;
   try{source=this.read(meta.sourceJob,owner,allowExpired);}catch(error){if(!allowExpired)throw error;meta.expiresAt=0;}
   if(source){meta.lastActivityAt=source.lastActivityAt;meta.expiresAt=source.filesExpired?0:source.expiresAt;}
  }
  if(!allowExpired&&(meta.status==='deleted'||meta.filesExpired||meta.expiresAt<=Date.now()&&!activeJob(meta)&&!this.holds.has(id)))throw unavailable();
  return meta;
 }
 write(meta){const dir=this.directory(meta.id);mkdirSync(dir,{recursive:true,mode:0o700});const temp=join(dir,'meta.tmp');writeFileSync(temp,JSON.stringify(meta),{mode:0o600});renameSync(temp,join(dir,'meta.json'));}
 list(owner,allowExpired=false){return readdirSync(this.root).filter(id=>/^[a-f0-9-]{36}$/.test(id)).flatMap(id=>{try{return [this.read(id,owner,allowExpired)];}catch{return [];}});}
 touch(id,owner){
  const meta=this.read(id,owner);
  if(meta.sourceJob){this.touch(meta.sourceJob,owner);return this.read(id,owner);}
  meta.lastActivityAt=Date.now();meta.expiresAt=meta.lastActivityAt+RETENTION_MS;this.write(meta);return meta;
 }
 hold(id,owner){
  const meta=this.read(id,owner),ids=meta.sourceJob?[id,meta.sourceJob]:[id];
  for(const key of ids)this.holds.set(key,(this.holds.get(key)||0)+1);
  let released=false;
  return ()=>{if(released)return;released=true;try{this.touch(id,owner);}catch{console.error('MCP transfer activity could not be saved.');}finally{for(const key of ids){const count=this.holds.get(key)-1;if(count)this.holds.set(key,count);else this.holds.delete(key);}}};
 }
 createUpload(owner,input,maxFileBytes=DEFAULT_FILE_BYTES){
  maxFileBytes=Math.min(MAX_FILE_BYTES,maxFileBytes);
  if(!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>maxFileBytes)throw new ServiceError(`Your MCP file limit is ${formatFileLimit(maxFileBytes)}. See /pricing for plan limits.`,413);
  if(this.list(owner).filter(x=>x.kind==='upload'&&x.status!=='deleted').length>=50)throw new ServiceError('File allowance reached. Temporary files expire after 2 hours without file activity.',429);
  const now=Date.now();
  const meta={id:randomUUID(),kind:'upload',owner,name:input.name,bytes:input.bytes,maxFileBytes,status:'pending',createdAt:now,lastActivityAt:now,expiresAt:now+RETENTION_MS};
  this.write(meta);return {file_id:meta.id,upload_url:this.signedUrl(meta.id,'upload'),method:'PUT',bytes:meta.bytes,max_file_bytes:maxFileBytes,file_expires_at:meta.expiresAt,delete_at:new Date(meta.expiresAt).toISOString(),expires_in_seconds:600};
 }
 signature(id,action,expires){return createHmac('sha256',this.secret).update(`${action}:${id}:${expires}`).digest('hex');}
 signedUrl(id,action,part){const expires=Math.floor(Date.now()/1000)+600;const url=new URL(`/mcp-files/${action}/${id}`,this.origin);url.searchParams.set('expires',String(expires));if(part)url.searchParams.set('part',part);url.searchParams.set('signature',this.signature(id,part?`${action}:${part}`:action,expires));return url.toString();}
 authorizeUrl(url,id,action){const part=action==='download'&&url.searchParams.get('part');const expires=Number(url.searchParams.get('expires')),signature=url.searchParams.get('signature')||'';if(!Number.isSafeInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+601||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(this.signature(id,part?`${action}:${part}`:action,expires),'hex')))throw new ServiceError('File URL is invalid or expired.',403);return this.read(id);}
 requireInput(id,owner,type){const meta=this.read(id,owner);if(meta.kind!=='upload'||meta.status!=='ready')throw new ServiceError('Upload the file before starting a task.');if(meta.sourceJob){const job=this.read(meta.sourceJob,owner);if(job.status!=='succeeded')throw new ServiceError('Output is not available.');}if(!supportsEditor(meta.name,type))throw new ServiceError('This file type does not match the tool.');return this.touch(id,owner);}
 outputInput(job,name){
  const id=createHash('sha256').update(job.id+'\0'+name).digest('hex');
  const fileId=`${id.slice(0,8)}-${id.slice(8,12)}-4${id.slice(13,16)}-8${id.slice(17,20)}-${id.slice(20,32)}`;
  if(!existsSync(join(this.root,fileId,'meta.json')))this.write({id:fileId,kind:'upload',owner:job.owner,name,bytes:statSync(join(this.directory(job.id),name)).size,status:'ready',sourceJob:job.id,sourceName:name,createdAt:job.createdAt,lastActivityAt:job.lastActivityAt,expiresAt:job.expiresAt});
  return fileId;
 }
 deleteFile(id,owner){
  const meta=this.read(id,owner,true);
  if(meta.kind!=='upload')throw new ServiceError('Use a file_id, not a job_id.');
  if(this.holds.has(id)||meta.sourceJob&&this.holds.has(meta.sourceJob))throw new ServiceError('This file is in use by a task or transfer. Wait for it to finish.',409);
  if(meta.status==='uploading')throw new ServiceError('The upload is in progress. Try again when it finishes.',409);
  if(meta.status==='deleted')return {file_id:id,deleted:true};
  if(meta.sourceJob){
   const job=this.read(meta.sourceJob,owner,true);
   rmSync(join(this.directory(job.id),meta.sourceName),{force:true});
   if(job.output===meta.sourceName)delete job.output;
   if(job.parts)job.parts=job.parts.filter(part=>part.name!==meta.sourceName);
   delete job.result;job.args={};job.files=[];job.filesDeleted=true;this.write(job);
  }else{rmSync(join(this.directory(id),'input'),{force:true});rmSync(join(this.directory(id),'input.uploading'),{force:true});}
  this.write({id,kind:'upload',owner,status:'deleted',createdAt:meta.createdAt,lastActivityAt:meta.lastActivityAt,expiresAt:meta.expiresAt,deletedAt:Date.now()});
  return {file_id:id,deleted:true};
 }
 inputPath(id,owner){const meta=this.read(id,owner);return meta.sourceJob?join(this.directory(meta.sourceJob),meta.sourceName):join(this.directory(id),'input');}
 async acceptUpload(id,req){
  const meta=this.read(id);if(meta.kind!=='upload'||meta.status!=='pending')throw new ServiceError('Upload URL already used.',409);
  const release=this.hold(id);meta.status='uploading';this.write(meta);
  const pending=join(this.directory(id),'input.uploading');
  const maxBytes=Math.min(MAX_FILE_BYTES,meta.maxFileBytes??DEFAULT_FILE_BYTES,meta.bytes);
  let size=0,header=Buffer.alloc(0),handle;
  try{
   handle=await open(pending,'wx',0o600);
   for await(const chunk of req){
    size+=chunk.length;if(size>maxBytes)throw new ServiceError('File exceeds its declared size or account limit.',413);
    if(header.length<1024)header=Buffer.concat([header,chunk.subarray(0,1024-header.length)]);
    await handle.writeFile(chunk);
   }
   await handle.close();handle=undefined;
   if(size!==meta.bytes)throw new ServiceError('Upload size does not match the declared size.');
   if(!matchesFileType(meta.name,header))throw new ServiceError('File contents do not match the declared extension.');
   renameSync(pending,join(this.directory(id),'input'));
   meta.status='ready';this.write(meta);return {file_id:id,status:'ready'};
  }catch(error){
   if(handle)await handle.close().catch(()=>{});
   rmSync(pending,{force:true});meta.status='pending';this.write(meta);throw error;
  }finally{release();}
 }
 cleanup(){
  const records=this.list(undefined,true),byId=new Map(records.map(meta=>[meta.id,meta])),protectedIds=new Set(this.holds.keys());
  for(const job of records)if(activeJob(job)){
   protectedIds.add(job.id);
   for(const {id} of job.files||[]){protectedIds.add(id);const source=byId.get(id)?.sourceJob;if(source)protectedIds.add(source);}
  }
  for(const meta of records){
   if(protectedIds.has(meta.id)||meta.sourceJob&&protectedIds.has(meta.sourceJob)||meta.expiresAt>Date.now())continue;
   try{
    if(meta.billing?.pending){
     for(const name of readdirSync(this.directory(meta.id)))if(name!=='meta.json')rmSync(join(this.directory(meta.id),name),{recursive:true,force:true});
     meta.args={};meta.files=[];meta.filesExpired=true;delete meta.result;delete meta.output;delete meta.parts;this.write(meta);
    }else rmSync(this.directory(meta.id),{recursive:true,force:true});
   }catch{console.error('Expired MCP files could not be removed; cleanup will retry.');}
  }
 }
}
