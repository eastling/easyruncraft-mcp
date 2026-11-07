import {z} from 'zod/v4';
import {ServiceError} from './files.mjs';
import {idSchema,requestId} from './schemas.mjs';

const ticksPerSecond=254016000000;
const time=z.number().min(0).max(120);
export const filmSchema=z.strictObject({
 file_id:idSchema, request_id:requestId,
 operation:z.discriminatedUnion('type', [
  z.strictObject({type:z.literal('inspect')}),
  z.strictObject({type:z.literal('render_frame'), seconds:time}),
  z.strictObject({type:z.literal('trim_video'), start:time, end:time})
   .refine(({start,end})=>end>start && end-start<=8,'Choose a range up to eight seconds.'),
 ]),
});

export async function executeFilm({operation}, input, run) {
 const {duration,video,audio_streams,container}=JSON.parse(await run(['probe',input]));
 const seconds=duration/ticksPerSecond;
 if (!video || !(seconds>0)) throw new ServiceError('Upload a video with a readable duration.');
 if (operation.type==='inspect') return {result:{seconds,video,audio_streams,container}};
 if (!(seconds<=120 && video.width>0 && video.height>0 && Math.max(video.width,video.height)<=1920 &&
       Math.min(video.width,video.height)<=1080 && video.frame_rate?.num/video.frame_rate?.den<=60)) {
  throw new ServiceError('Use a clip of up to 120 seconds, 1920 by 1080 pixels and 60 fps.');
 }
 const frame=operation.type==='render_frame';
 if (frame ? operation.seconds>=seconds : operation.end>seconds) throw new ServiceError('The selected time is outside the clip.');
 const output=frame ? 'result.png' : 'result.mp4';
 const steps=[
  {id:'file.import',params:{paths:[input]}},
  {id:'project.select',params:{items:[1]}},
  {id:'file.newSequenceFromClip',params:{items:[1]}},
  frame ? {id:'file.exportFrame',params:{path:output,time:Math.round(operation.seconds*ticksPerSecond)}} :
   {id:'file.exportMedia',params:{path:output,format:'h264',range:'custom',startSeconds:operation.start,endSeconds:operation.end,
    hardwareEncoding:'off',scale:Math.min(1,960/Math.max(video.width,video.height)),wait:true}},
 ];
 const stdout=await run(['--compact','run','-'],steps.map(step=>JSON.stringify(step)).join('\n')+'\n');
 const replies=stdout.trim().split('\n').map(line=>JSON.parse(line));
 const completed=replies.at(-1);
 if (replies[0]?.result?.items?.[0]!==1 || !completed?.ok || completed.id!==steps.at(-1).id || completed.result?.offlineMedia?.length) {
  throw new ServiceError('FilmCraft did not confirm a complete export.');
 }
 return {output,result:frame ? {seconds:operation.seconds,width:completed.result.width,height:completed.result.height}
  : {start:operation.start,end:operation.end,frames:completed.result.result?.frames,format:'mp4'}};
}
