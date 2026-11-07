import {createHash} from 'node:crypto';
import rates from './billing-rates.json' with {type:'json'};
import {ServiceError} from './files.mjs';
export function taskCredits(){
 return rates.standardCredits;
}
export function createBillingClient(origin,secret){
 return async(action,meta)=>{
  if(!secret||secret.length<32)throw new ServiceError('MCP billing is not configured.',503);
  const response=await fetch(new URL('/api/mcp/billing',origin),{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify({action,jobId:meta.id,userId:meta.owner,requestId:meta.requestId,fingerprint:meta.billing.fingerprint??createHash('sha256').update(JSON.stringify([meta.type,meta.args])).digest('hex'),tool:meta.type,credits:meta.billing.credits}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok)throw new ServiceError(result.error||'MCP billing unavailable.',response.status);
  return result;
 };
}
