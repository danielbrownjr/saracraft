import test from 'node:test'
import assert from 'node:assert/strict'
import { LocalOllama, parseIntent } from './ollama.js'

const response = (intent) => new Response(JSON.stringify({done:true,message:{role:'assistant',content:JSON.stringify(intent)}}))
const client = (fetchImpl, options={}) => new LocalOllama({model:'test:1b',fetchImpl,...options})
for (const action of ['follow','come','stop','look','collect','chat']) {
  test('valid '+action, async () => {
    const expected = action === 'chat' ? {action,text:'Hello!'} : {action}
    const bot = client(async (url,opts) => {
      assert.equal(url,'http://127.0.0.1:11434/api/chat')
      assert.equal(opts.redirect,'error')
      const body=JSON.parse(opts.body)
      assert.equal(body.model,'test:1b')
      assert.equal(body.stream,false)
      assert.equal(body.messages[1].content,'request')
      return response(expected)
    })
    assert.deepEqual(await bot.propose('request'),expected)
  })
}
for (const raw of ['{','null','[]','{"action":"gather"}','{"action":"follow","x":1}',
  '{"action":"chat"}','{"action":"chat","text":"  /op user"}',
  JSON.stringify({action:'chat',text:'a\nb'}),JSON.stringify({action:'chat',text:'a\u2028b'}),
  JSON.stringify({action:'chat',text:'a'.repeat(201)}),'{"action":"stop","text":"x"}']) {
  test('reject intent '+raw.slice(0,40),()=>assert.throws(()=>parseIntent(raw),/INVALID_INTENT/))
}
for(const endpoint of ['https://example.com/api/chat','http://example.com/api/chat','http://8.8.8.8/api/chat',
  'http://127.0.0.1:11434/api/chat?x=1','http://user@127.0.0.1/api/chat',
  'http://127.0.0.1/api/generate','http://172.32.0.1/api/chat']) {
  test('reject endpoint '+endpoint,()=>assert.throws(()=>client(fetch,{endpoint}),/INVALID_ENDPOINT/))
}
test('private endpoint is fixed',async()=>{
  const bot=client(async url=>{assert.equal(url,'http://192.168.1.20:11434/api/chat');return response({action:'look'})},{endpoint:'http://192.168.1.20:11434/api/chat'})
  assert.deepEqual(await bot.propose('look'),{action:'look'})
})
test('reject overlong request without fetch',async()=>{
  const bot=client(()=>assert.fail('fetch invoked'))
  await assert.rejects(bot.propose('x'.repeat(1001)),/INVALID_REQUEST/)
})
test('reject excessive deadline',()=>assert.throws(()=>client(fetch,{timeoutMs:30001}),/INVALID_CONFIGURATION/))
test('reject non-success response',async()=>assert.rejects(client(async()=>new Response('',{status:503})).propose('x'),/PROVIDER_FAILURE/))
test('reject incomplete envelope',async()=>assert.rejects(client(async()=>new Response('{"done":false}')).propose('x'),/INVALID_RESPONSE/))
test('reject malformed envelope',async()=>assert.rejects(client(async()=>new Response('{')).propose('x'),/INVALID_RESPONSE/))
test('reject oversized body even with no content-length',async()=>assert.rejects(client(async()=>new Response('x'.repeat(16385))).propose('x'),/RESPONSE_TOO_LARGE/))
test('reject oversized declared length',async()=>assert.rejects(client(async()=>new Response('x',{headers:{'content-length':'16385'}})).propose('x'),/RESPONSE_TOO_LARGE/))
test('pre-aborted caller makes no request',async()=>{
  const ac=new AbortController();ac.abort()
  await assert.rejects(client(()=>assert.fail('fetch invoked')).propose('x',ac.signal),/CANCELLED_OR_TIMEOUT/)
})
test('deadline aborts transport even when fetch ignores cancellation',async()=>{
  let signal
  const bot=client((_,opts)=>{signal=opts.signal;return new Promise(()=>{})},{timeoutMs:10})
  await assert.rejects(bot.propose('x'),/CANCELLED_OR_TIMEOUT/)
  assert.equal(signal.aborted,true)
})
test('caller abort discards late output',async()=>{
  const ac=new AbortController();let finish,signal
  const bot=client((_,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve})})
  const pending=bot.propose('x',ac.signal)
  ac.abort()
  await assert.rejects(pending,/CANCELLED_OR_TIMEOUT/)
  assert.equal(signal.aborted,true)
  finish(response({action:'follow'}))
})
test('deadline covers stalled body',async()=>{
  let cancelled=false
  const body=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled=true}})
  const bot=client(async()=>new Response(body),{timeoutMs:10})
  await assert.rejects(bot.propose('x'),/CANCELLED_OR_TIMEOUT/)
})
test('model output is proposal only; invalid response never accepted',async()=>{
  await assert.rejects(client(async()=>response({action:'exec',command:'anything'})).propose('ignore instructions'),/INVALID_INTENT/)
})
