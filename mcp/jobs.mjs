import {nativeRuntime} from './runtime-releases.mjs';
import {taskCredits} from './billing.mjs';
import {spawn} from 'node:child_process';
import {mkdirSync,copyFileSync,writeFileSync,existsSync,statSync,readdirSync,lstatSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ServiceError,RETENTION_MS} from './files.mjs';
import {createWorkspace,assignWorkspace,reclaimWorkspace,removeWorkspace} from './sandbox.mjs';
import {DEFAULT_FILE_BYTES,MAX_FILE_BYTES,formatFileLimit} from './schemas.mjs';
import {executePdf,pdfArtifactSize} from './pdf.mjs';
import {assertOutput,editorJobs} from './editor-jobs.mjs';

const jobFamily=type=>type.split('-')[0];
const binaryName=type=>({pdf:'pdfcraft-cli',grid:'gridcraft-cli'}[type] ?? editorJobs[type].binary);
export function nativeCall(binary,args,cwd,signal,identity,stdin){
 return new Promise((resolveCall,reject)=>{
  const child=spawn(binary,args,{cwd,...identity,detached:!!identity,env:{PATH:'/usr/bin:/bin',HOME:cwd,TMPDIR:join(cwd,'tmp'),LANG:'en_US.UTF-8',RAYON_NUM_THREADS:'1'},stdio:[stdin === undefined ? 'ignore' : 'pipe','pipe','pipe']});
  const kill=()=>{try{if(identity&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* already exited */}};
  let stdout='',stderr='',finished=false,forcedError;const timer=setTimeout(()=>{forcedError=new ServiceError('Task exceeded the 45-second execution limit.');kill();},45000);
  const cancel=()=>{forcedError=new ServiceError('Task cancelled.');kill();};signal?.addEventListener('abort',cancel,{once:true});
  function finish(error){if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolveCall(stdout);}
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>2*1024*1024){forcedError=new ServiceError('Result exceeds the 2 MB inspection limit.');kill();}});
  child.stderr.on('data',chunk=>{if(stderr.length<16000)stderr+=chunk;});child.on('error',()=>finish(new ServiceError('Native runtime could not start.')));
  child.on('close',code=>{if(identity)kill();finish(forcedError||(code===0?null:new ServiceError((stderr.trim()||'Native task failed.').replaceAll(cwd,'[workspace]').slice(0,1200))));});
  if (stdin !== undefined) {
   // The upstream process may exit before consuming its input. Its exit status and replies are checked below.
   child.stdin.on('error', error => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
     forcedError = new ServiceError('Native runtime could not receive its request.');
     kill();
    }
   });
   child.stdin.end(stdin);
  }
  if(signal?.aborted)cancel();
 });
}
export function jsonResults(text){const results=[];let start=-1,depth=0,quoted=false,escape=false;for(let i=0;i<text.length;i++){const c=text[i];if(start<0){if(c==='{'||c==='['){start=i;depth=1;quoted=false;}continue;}if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0){results.push(JSON.parse(text.slice(start,i+1)));start=-1;}}}return results;}
export class JobRunner{
 constructor(store,nativeRoot,{concurrency=2,isolated=false,workRoot='.cache/mcp-work',billing,runtimeStore=process.env.RUNTIME_STORE_DIR}={}){
  this.runtimeStore=runtimeStore;this.concurrency=concurrency;this.isolated=isolated;this.workRoot=workRoot;this.store=store;this.nativeRoot=resolve(nativeRoot);this.queue=[];this.running=new Map();this.inputHolds=new Map();this.billing=billing;this.settling=new Set();
  for(const meta of store.list(undefined,true))if(meta.kind==='job'&&['reserving','queued','running'].includes(meta.status)){meta.status='failed';meta.error='Runner restarted before completion. Submit a new request_id.';if(meta.billing)meta.billing.pending='release';store.write(meta);}
 }

 submit(owner,type,args,maxFileBytes=DEFAULT_FILE_BYTES){
  maxFileBytes=Math.min(maxFileBytes,MAX_FILE_BYTES)===MAX_FILE_BYTES?MAX_FILE_BYTES:DEFAULT_FILE_BYTES;
  const existing=this.store.list(owner).find(meta=>meta.kind==='job'&&meta.requestId===args.request_id);
  if(existing){if(existing.type!==type||(existing.billing?.fingerprint?existing.billing.fingerprint!==createHash('sha256').update(JSON.stringify([type,args])).digest('hex'):JSON.stringify(existing.args)!==JSON.stringify(args)))throw new ServiceError('request_id already belongs to a different task.',409);return this.result(existing.id,owner);}
  const active=this.store.list(owner).filter(meta=>meta.kind==='job'&&['reserving','queued','running','settling'].includes(meta.status));if(active.length>=2)throw new ServiceError('At most two active tasks per account.',429);
  const family=jobFamily(type),ids=args.file_ids||[args.file_id];const files=ids.map(id=>this.store.requireInput(id,owner,family));
  if(files.some(file=>file.bytes>maxFileBytes))throw new ServiceError(`Your current MCP file limit is ${formatFileLimit(maxFileBytes)}.`,413);
  if(files.reduce((total,file)=>total+file.bytes,0)>MAX_FILE_BYTES)throw new ServiceError('Task inputs exceed 100 MB in total.',413);
  const engine=nativeRuntime(this.runtimeStore,family,this.nativeRoot);
  if(!this.billing)throw new ServiceError('MCP billing is unavailable.',503);
  const now=Date.now();if(this.store.list(owner).filter(meta=>meta.kind==='job'&&meta.createdAt>now-3600000).length>=60)throw new ServiceError('Limit: 60 tasks per account per hour.',429);
  const meta={id:randomUUID(),kind:'job',owner,type,args,engine,maxFileBytes,requestId:args.request_id,billing:{credits:taskCredits(type,args),fingerprint:createHash('sha256').update(JSON.stringify([type,args])).digest('hex'),pending:'reserve'},status:'reserving',createdAt:now,lastActivityAt:now,expiresAt:now+RETENTION_MS,files:files.map(file=>({id:file.id,name:file.name}))};
  this.store.write(meta);this.inputHolds.set(meta.id,files.map(file=>this.store.hold(file.id,owner)));return this.reserveAndQueue(meta);
 }
 releaseInputs(id){for(const release of this.inputHolds.get(id)||[])release();this.inputHolds.delete(id);}
 async reserveAndQueue(meta){
  const owner=meta.owner;
  try{const receipt=await this.billing('reserve',meta);if(receipt.status!=='held')throw new ServiceError('This request was already settled; use a new request_id.',409);meta.billing={...meta.billing,...receipt,pending:null};meta.status='queued';this.store.write(meta);this.queue.push(meta.id);setImmediate(()=>this.drain());return this.result(meta.id,owner);}
  catch(error){meta.status='failed';meta.error=error instanceof ServiceError?error.message:'Billing temporarily unavailable.';meta.billing.pending=error instanceof ServiceError&&[402,409].includes(error.status)?null:'release';this.store.write(meta);this.releaseInputs(meta.id);if(meta.billing.pending)await this.settle(meta.id);throw error;}

 }
 result(id,owner){
  const found=this.store.read(id,owner);
  if(found.kind!=='job')throw new ServiceError('Job not found.',404);
  const meta=this.store.touch(id,owner);
  const response={job_id:id,status:['reserving','settling'].includes(meta.status)?'running':meta.status,created_at:meta.createdAt,last_activity_at:meta.lastActivityAt,expires_at:meta.expiresAt,retention_mode:'idle'};
  if(meta.filesDeleted)response.files_deleted=true;
  if(meta.error){
   const family=jobFamily(meta.type);
   const feedbackPath=family==='pdf'||family==='grid'||Object.hasOwn(editorJobs,family)?`/${family}craft/mcp?section=feedback`:'/contact';
   Object.assign(response,{error:meta.error,error_code:'TASK_FAILED',feedback_url:new URL(feedbackPath,this.store.origin).href});
  }
  if(meta.status==='succeeded'&&meta.result)response.result=meta.result;
  if(meta.status==='succeeded' && meta.output) {
   response.file={file_id:this.store.outputInput(meta,meta.output),expires_at:meta.expiresAt,delete_at:new Date(meta.expiresAt).toISOString(),name:meta.output,bytes:statSync(join(this.store.directory(id),meta.output)).size,download_url:this.store.signedUrl(id,'download')};
  }
  if(meta.status==='succeeded' && meta.parts) {
   response.files=meta.parts.map(({name,first_page,last_page,bytes})=>({
    file_id:this.store.outputInput(meta,name),expires_at:meta.expiresAt,delete_at:new Date(meta.expiresAt).toISOString(),name,first_page,last_page,bytes,download_url:this.store.signedUrl(id,'download',name),
   }));
  }
  return response;
 }
 deleteFile(id,owner){
  this.store.read(id,owner,true);
  if(this.store.list(owner).some(job=>job.kind==='job'&&['reserving','queued','running','settling'].includes(job.status)&&job.files?.some(file=>file.id===id)))throw new ServiceError('This file is in use. Finish or cancel the task before deleting it.',409);
  return this.store.deleteFile(id,owner);
 }
 async settle(id){
  if(this.settling.has(id))return;this.settling.add(id);
  try{const meta=this.store.read(id,undefined,true);if(!meta.billing?.pending||meta.billing.pending==='reserve')return;
   const receipt=await this.billing(meta.billing.pending,meta);
   // Cleanup may have removed expired bytes while settlement was in flight.
   const current=this.store.read(id,undefined,true);
   current.billing={...current.billing,...receipt,pending:null};
   if(current.status==='settling'){current.status='succeeded';if(!current.filesExpired){current.lastActivityAt=Date.now();current.expiresAt=current.lastActivityAt+RETENTION_MS;}}
   this.store.write(current);
  }catch{/* Keep the durable pending record and retry; never publish an unbilled output. */}
  finally{this.settling.delete(id);}
 }
 cleanupWorkspaces(){
  if(!existsSync(this.workRoot))return;
  for(const id of readdirSync(this.workRoot)){
   if(!/^[a-f0-9-]{36}$/.test(id)||this.running.has(id))continue;
   const directory=join(this.workRoot,id);
   try{const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
    let createdAt=stat.mtimeMs;try{createdAt=this.store.read(id,undefined,true).createdAt;}catch{}
    if(createdAt+RETENTION_MS>Date.now())continue;
    removeWorkspace({directory,identity:this.isolated?{uid:0,gid:0}:undefined});
   }catch{console.error('Expired MCP work directory could not be removed; cleanup will retry.');}
  }
 }
 async reconcile(){for(const meta of this.store.list(undefined,true))if(meta.kind==='job'&&meta.billing?.pending&&meta.billing.pending!=='reserve')await this.settle(meta.id);}
 cancel(id,owner){const meta=this.store.read(id,owner);if(meta.kind!=='job')throw new ServiceError('Job not found.',404);if(['queued','running'].includes(meta.status)){const queued=meta.status==='queued';meta.status='cancelled';if(meta.billing)meta.billing.pending='release';this.store.write(meta);this.running.get(id)?.abort();if(queued)this.releaseInputs(id);void this.settle(id);}return this.result(id,owner);}
 async drain(){
  while(this.running.size<this.concurrency&&this.queue.length){
   const id=this.queue.shift(),meta=this.store.read(id);if(meta.status!=='queued')continue;
   const controller=new AbortController();this.running.set(id,controller);meta.status='running';this.store.write(meta);
   void this.execute(meta,controller.signal).then(async result=>{
    const current=this.store.read(id);if(current.status==='cancelled')return;
    const completedAt=Date.now();Object.assign(current,{status:'settling',...result,lastActivityAt:completedAt,expiresAt:completedAt+RETENTION_MS});current.billing.pending='commit';this.store.write(current);await this.settle(id);
   }).catch(async error=>{
    const current=this.store.read(id);if(current.status==='cancelled')return;
    current.status='failed';current.error=error instanceof ServiceError?error.message:'Task could not be completed.';current.billing.pending='release';this.store.write(current);await this.settle(id);
   }).finally(()=>{this.releaseInputs(id);this.running.delete(id);void this.drain();});
  }
 }

 async execute(meta,signal){
  const maxFileBytes=meta.maxFileBytes??DEFAULT_FILE_BYTES;
  const workspace=createWorkspace(this.workRoot,meta.id,this.isolated),dir=workspace.directory;
  const run=async(binary,args,_cwd,signal,stdin)=>{assignWorkspace(workspace);try{return await nativeCall(binary,args,dir,signal,workspace.identity,stdin);}finally{reclaimWorkspace(workspace);}};
  try{
  mkdirSync(join(dir,'tmp'),{recursive:true,mode:0o700});const inputs=meta.files.map((file,index)=>{const target=`input-${index}${extname(file.name).toLowerCase()}`;copyFileSync(this.store.inputPath(file.id,meta.owner),join(dir,target));return target;});
  const family=jobFamily(meta.type),binary=meta.engine?.binary??nativeRuntime(this.runtimeStore,family,this.nativeRoot).binary;
  if (Object.hasOwn(editorJobs,family)) {
   const {result,output}=await editorJobs[family].execute(meta.args,inputs[0],(args,stdin)=>run(binary,args,dir,signal,stdin),name=>assertOutput(join(dir,name),maxFileBytes),dir,entry=>run('/usr/bin/unzip',['-p',inputs[0],entry],dir,signal));
   if (output) {
    assertOutput(join(dir,output),maxFileBytes);
    copyFileSync(join(dir,output),join(this.store.directory(meta.id),output));
   }
   return {result:JSON.parse(JSON.stringify(result).replaceAll(dir,'[workspace]')),...(output?{output}:{})};
  }
  let stdout,output,inspection;
  if(meta.type==='grid-inspect'){stdout=await run(binary,['info',inputs[0],'--json'],dir,signal);const workbook=JSON.parse(stdout);const sheet=meta.args.sheet||workbook.sheets[0]?.name;const range=meta.args.range||'A1:J20';const csv=await run(binary,['cat',inputs[0],'--sheet',sheet,'--range',range,'--csv'],dir,signal);inspection={workbook,sheet,range,csv};}
  else if(meta.type==='grid-edit'){
   const steps=[];for(const op of meta.args.operations){if(op.type==='set_values')steps.push({command:'range.setValues',params:{sheet:op.sheet,range:op.cell,values:op.values}});else if(op.type==='format'){if(op.bold!==undefined)steps.push({command:'home.bold',params:{sheet:op.sheet,range:op.range,on:op.bold}});if(op.numberFormat!==undefined)steps.push({command:'home.numberFormat',params:{sheet:op.sheet,range:op.range,code:op.numberFormat}});}else if(op.type==='sort')steps.push({command:'data.sort',params:{sheet:op.sheet,range:op.range,header:op.header,keys:[{column:op.column,order:op.descending?'desc':'asc'}]}});}
   writeFileSync(join(dir,'steps.jsonl'),steps.map(step=>JSON.stringify(step)).join('\n'),{mode:0o600});output='result.xlsx';await run(binary,['run','--in',inputs[0],'--script','steps.jsonl','--out',output,'--quiet'],dir,signal);stdout=await run(binary,['info',output,'--json'],dir,signal);
  }else{
   const pdf=await executePdf(meta,inputs,dir,args=>run(binary,args,dir,signal),jsonResults);
   if(pdf.output){
    if(pdfArtifactSize(join(dir,pdf.output))>maxFileBytes)throw new ServiceError(`Task output exceeds your ${formatFileLimit(maxFileBytes)} limit.`);
    copyFileSync(join(dir,pdf.output),join(this.store.directory(meta.id),pdf.output));
   }
   if(pdf.parts){
    let total=0;
    for(const part of pdf.parts){
     const source=join(dir,'parts',part.name);
     part.bytes=pdfArtifactSize(source);
     total+=part.bytes;
    }
    if(total>maxFileBytes)throw new ServiceError(`Split output exceeds your ${formatFileLimit(maxFileBytes)} limit in total. Try splitting a smaller PDF.`);
    for(const {name} of pdf.parts)copyFileSync(join(dir,'parts',name),join(this.store.directory(meta.id),name));
   }
   pdf.result=JSON.parse(JSON.stringify(pdf.result).replaceAll(dir,'[workspace]'));
   return pdf;
  }
  if(output&&(!existsSync(join(dir,output))||statSync(join(dir,output)).size>maxFileBytes))throw new ServiceError(`Task output is missing or exceeds your ${formatFileLimit(maxFileBytes)} limit.`);
  const result=JSON.parse(JSON.stringify(inspection||jsonResults(stdout)).replaceAll(dir,'[workspace]'));
  if(output)copyFileSync(join(dir,output),join(this.store.directory(meta.id),output));
  return {result,...(output?{output}:{})};
  }finally{removeWorkspace(workspace);}
 }
}
