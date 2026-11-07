import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

export const soundSchema = z.strictObject({
 file_id:idSchema, request_id:requestId,
 operation:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('convert'), format:z.enum(['wav','flac']), normalize:z.boolean().default(false)}),
  z.strictObject({type:z.literal('adjust_gain'), db:z.number().min(-60).max(12)}),
 ]),
});

export async function executeSound({operation}, input, run, assertOutput) {
 const info=async file=>JSON.parse(await run(['info',file]));
 const before=await info(input);
 if (operation.type==='inspect') return {result:before};
 if (!(before.seconds>0 && before.seconds<=60 && before.channels>=1 && before.channels<=2 && before.sample_rate<=96000)) {
  throw new ServiceError('Audio output supports up to 60 seconds, two channels and a 96 kHz input sample rate.');
 }
 const output=operation.type==='convert' ? `result.${operation.format}` : 'result.wav';
 if (operation.type==='convert') {
  await run(['convert',input,output,...(operation.normalize?['--normalize']:[])]);
 } else {
  // A blank SoundCraft session allocates its source first and the imported track second.
  const command = (id,params)=>id+'='+JSON.stringify(params);
  const stdout=await run(['run','--cmd',command('file.import_audio',{path:input}),
   '--cmd',command('mix.volume',{tracks:[2],db:operation.db}),'--bounce',output]);
  const lines=stdout.trim().split('\n');
  const imported=lines.find(line=>line.startsWith('file.import_audio: '));
  const mixed=lines.find(line=>line.startsWith('mix.volume: '));
  if (!imported || !mixed || JSON.parse(imported.slice('file.import_audio: '.length)).imported?.[0]?.track!==2 ||
      JSON.parse(mixed.slice('mix.volume: '.length)).tracks!==1) {
   throw new ServiceError('SoundCraft did not confirm the level adjustment.');
  }
 }
 assertOutput(output);
 return {output,result:await info(output)};
}
