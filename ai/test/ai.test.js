import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProposal} from '../src/schemas.js';
import {IntentPlanner} from '../src/planner.js';
import {ChatProvider} from '../src/provider.js';
const request=(action,args={})=>({action,args});
test('game and ops scopes are disjoint',()=>{
  assert.equal(validateProposal(request('restart'),'ops').action,'restart');
  assert.throws(()=>validateProposal(request('restart'),'game'),/DENIED_ACTION/);
  assert.throws(()=>validateProposal(request('gather',{block:'oak_log',count:1}),'ops'),/DENIED_ACTION/);
});
test('rejects shell, eval, arbitrary console and extra parameters',()=>{
  for(const action of ['sudo','docker','exec','shell','console','none']) assert.throws(()=>validateProposal(request(action),'ops'),/DENIED_ACTION/);
  assert.throws(()=>validateProposal(request('restart',{command:'sh'}),'ops'),/UNEXPECTED_ARGS/);
  assert.throws(()=>validateProposal(request('allowlist_add',{username:'a;rm -rf'}),'ops'),/INVALID_USERNAME/);
});
test('validates gathering limits',()=>{
  for(const count of [0,33,1.5,'32']) assert.throws(()=>validateProposal(request('gather',{block:'oak_log',count}),'game'),/INVALID_GATHER/);
  assert.equal(validateProposal(request('gather',{block:'spruce_log',count:2}),'game').args.count,2);
});
test('planner only proposes, never invokes an action',async()=>{
  const planner=new IntentPlanner({provider:{complete:async()=>JSON.stringify(request('backup'))}});
  assert.deepEqual(await planner.propose({text:'save a backup',scope:'ops'}),request('backup'));
});
test('unrecognized or invalid model responses fail closed',async()=>{
  const unsupported=new IntentPlanner({provider:{complete:async()=>JSON.stringify(request('none'))}});
  await assert.rejects(unsupported.propose({text:'format drive',scope:'ops'}),/DENIED_ACTION/);
  const malformed=new IntentPlanner({provider:{complete:async()=>'{bad'}});
  await assert.rejects(malformed.propose({text:'status',scope:'ops'}),/INVALID_MODEL_JSON/);
});
test('endpoint must be TLS or local loopback',()=>{
  for(const endpoint of ['http://example.com/v1/chat/completions','https://u:p@example.com/v1/chat/completions','https://example.com/anything']) assert.throws(()=>new ChatProvider({endpoint,model:'m'}));
  assert.doesNotThrow(()=>new ChatProvider({endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'qwen3:8b'}));
});
test('bounded request, secret confined to auth header',async()=>{
  let sent;
  const provider=new ChatProvider({endpoint:'https://api.example.com/v1/chat/completions',model:'m',apiKey:'secret',fetchImpl:async(url,init)=>{sent={url,init};return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"action":"health"}'}}]})};}});
  assert.equal(await provider.complete([{role:'user',content:'status'}]),'{"action":"health"}');
  assert.equal(sent.init.headers.Authorization,'Bearer secret');
  assert.equal(JSON.parse(sent.init.body).max_tokens,180);
});
test('provider errors do not include response body',async()=>{
  const provider=new ChatProvider({endpoint:'https://example.com/v1/chat/completions',model:'m',fetchImpl:async()=>({ok:false,text:async()=> 'SECRET'})});
  await assert.rejects(provider.complete([{role:'user',content:'x'}]),/PROVIDER_FAILURE/);
});
test('pre-aborted signal cancels request',async()=>{
  const signal=new AbortController();signal.abort();
  const provider=new ChatProvider({endpoint:'https://example.com/v1/chat/completions',model:'m',fetchImpl:async(_url,{signal})=>{if(signal.aborted)throw Error('cancelled');return {ok:false};}});
  await assert.rejects(provider.complete([{role:'user',content:'x'}],signal.signal),/PROVIDER_TIMEOUT_OR_CANCELLED/);
});
