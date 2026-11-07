import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {currentRuntimes,nativeRuntime,runtimeSlugs} from './runtime-releases.mjs';
const root=process.env.RUNTIME_STORE_DIR,manifest=currentRuntimes(root);
for(const slug of runtimeSlugs){
 const engine=nativeRuntime(root,slug),pin=JSON.parse(readFileSync(new URL('./manifest.json','file://'+engine.binary),'utf8'));
 const expected=pin.files.find(file=>file.path===slug+'craft-cli');
 if(createHash('sha256').update(readFileSync(engine.binary)).digest('hex')!==expected.sha256)throw new Error('Native executable checksum mismatch: '+slug);
 const child=spawnSync(engine.binary,[slug==='grid'?'version':'--version'],{encoding:'utf8',timeout:30000,uid:65534,gid:65534,cwd:'/tmp',env:{PATH:'/usr/bin:/bin',HOME:'/tmp',LANG:'C.UTF-8'}});
 if(child.status!==0||!child.stdout.includes(manifest.editors[slug].native.version))throw new Error('Native executable startup/version check failed: '+slug);
 console.log(slug+' '+engine.version+' verified');
}
