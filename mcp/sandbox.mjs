import {mkdirSync,readdirSync,lstatSync,chownSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {randomInt} from 'node:crypto';
import {ServiceError} from './files.mjs';
/** Production native processes get a unique Unix uid and no account/file-store access. */
const activeUids=new Set();
export function createWorkspace(root,id,isolated){
 const base=resolve(root);mkdirSync(base,{recursive:true,mode:0o711});
 if(isolated){if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Production native uid isolation requires the Linux runner container.');chmodSync(base,0o711);}
 const directory=join(base,id);if(dirname(directory)!==base)throw new Error('Invalid workspace id');mkdirSync(directory,{mode:0o700});
 let identity;if(isolated){let uid;do{uid=randomInt(20000,60000);}while(activeUids.has(uid));activeUids.add(uid);identity={uid,gid:uid};}return {directory,identity};
}
function walk(directory,action,postorder=false){const entries=readdirSync(directory);for(const name of entries){const path=join(directory,name),stat=lstatSync(path);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory())||stat.isFile()&&stat.nlink!==1)throw new ServiceError('Native task produced an unsupported filesystem object.');if(postorder&&stat.isDirectory())walk(path,action,true);action(path,stat.isDirectory());if(!postorder&&stat.isDirectory())walk(path,action);}}
export function reclaimWorkspace(workspace){if(!workspace.identity)return;const action=(path,directory)=>{chownSync(path,0,0);chmodSync(path,directory?0o700:0o600);};action(workspace.directory,true);walk(workspace.directory,action);}
export function assignWorkspace(workspace){if(!workspace.identity)return;const {uid,gid}=workspace.identity;walk(workspace.directory,(path,directory)=>{chmodSync(path,directory?0o700:0o600);chownSync(path,uid,gid);},true);chmodSync(workspace.directory,0o700);chownSync(workspace.directory,uid,gid);}
export function removeWorkspace(workspace){try{reclaimWorkspace(workspace);}finally{rmSync(workspace.directory,{recursive:true,force:true});if(workspace.identity)activeUids.delete(workspace.identity.uid);}}
