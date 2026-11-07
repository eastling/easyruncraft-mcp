import {timingSafeEqual} from 'node:crypto';
import {fetchClientMetadataResource} from '@better-auth/cimd/node';

// Private MCP discovery egress. The official transport pins a verified public IP to TLS.
export async function serveClientMetadata(req,res,secret){
  const actual=Buffer.from(req.headers.authorization||'');
  const expected=Buffer.from('Bearer '+secret);
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected)){
    res.writeHead(403).end();return;
  }
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let body='';
  for await(const chunk of req){body+=chunk;if(body.length>8192){res.writeHead(413).end();return;}}
  try{
    const input=JSON.parse(body);
    const url=new URL(input.url);
    if(url.protocol!=='https:'||url.username||url.password||!['HEAD','GET'].includes(input.method)){
      res.writeHead(400).end();return;
    }
    const headers=new Headers();
    for(const name of ['accept','if-none-match','if-modified-since'])if(typeof input.headers?.[name]==='string')headers.set(name,input.headers[name]);
    const upstream=await fetchClientMetadataResource(url,{method:input.method,headers,redirect:'manual',signal:AbortSignal.timeout(6000)});
    if(upstream.status>=300 && upstream.status<400 && upstream.status!==304){await upstream.body?.cancel();res.writeHead(400).end();return;}
    const chunks=[];let bytes=0;
    if(upstream.body)for await(const chunk of upstream.body){
      bytes+=chunk.length;if(bytes>65536)throw Error('Metadata too large');chunks.push(chunk);
    }
    const out={};
    for(const name of ['content-type','etag','last-modified','cache-control'])if(upstream.headers.has(name))out[name]=upstream.headers.get(name);
    res.writeHead(upstream.status,out).end(Buffer.concat(chunks));
  }catch{res.writeHead(502).end();}
}
