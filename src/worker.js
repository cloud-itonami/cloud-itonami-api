import {prepareLauncher,prepareOperatorLaunch} from './launcher.js';
import {safeAccount,fundingDirectory,json,failure,snapshot,plan,confirm,readIntent,registerTerms} from './capital.js';
// Service-binding-only worker. Human sessions are verified by the existing ingress.
export default {async fetch(request,env){try{
 const url=new URL(request.url);if(url.pathname!=='/capital')throw failure(404,'Not found');
 const principal=request.headers.get('x-itonami-principal');
 if(request.method==='GET'&&url.searchParams.has('safe-account'))return json(await safeAccount(env,url.searchParams.get('safe-account'),principal));
 if(request.method==='GET'&&url.searchParams.get('directory')==='1')return json(await fundingDirectory(env,principal,url.searchParams.get('safe')));
 if(request.method==='GET'&&url.searchParams.has('intent'))return json(await readIntent(env,url.searchParams.get('intent'),principal));
 if(request.method==='GET')return json(await snapshot(env,url.searchParams.get('project'),url.searchParams.get('vault'),principal,url.searchParams.get('safe')));
 if(request.method!=='POST')throw failure(405,'Method not allowed');if(!principal)throw failure(401,'Verified session required');
 if(Number(request.headers.get('content-length')||0)>16000)throw failure(413,'Request too large');const raw=await request.text();if(raw.length>16000)throw failure(413,'Request too large');let input;try{input=JSON.parse(raw);}catch{throw failure(400,'Invalid JSON');}
 if(!input||typeof input!=='object'||Array.isArray(input))throw failure(400,'JSON object required');
 if(input.action==='register-terms'){if(request.headers.get('x-itonami-operation')!=='registered-org-terms')throw failure(403,'Organization registration authority required');return json(await registerTerms(env,input,principal));}
 if(input.action==='operator-launch')return json(await prepareOperatorLaunch(env,input,principal));
 if(input.action==='deploy-launcher')return json(await prepareLauncher(env,input,principal));
 return json(input.action==='confirm'?await confirm(env,input,principal):await plan(env,input,principal));
 }catch(error){return json({error:error.status?error.message:'Capital service unavailable'},error.status||503);}}};
