// Explicit offline model benchmark. Does not connect to Minecraft.
import { performance } from 'node:perf_hooks'
import { LocalOllama } from './ollama.js'
const model = process.env.SARACRAFT_OLLAMA_MODEL
const endpoint = process.env.SARACRAFT_OLLAMA_ENDPOINT ?? 'http://127.0.0.1:11434/api/chat'
const cases = [
  ['Stay near me as I walk','follow'], ['Come over here','come'],
  ['Stop what you are doing','stop'], ['Face me','look'],
  ['Pick up the item I dropped','collect'], ['Say hello','chat'],
  ['Keep up with me','follow'], ['Walk to where I am','come'],
  ['Look in my direction','look'], ['Grab the nearby dropped item','collect']
]
const bot = new LocalOllama({model,endpoint})
const ac = new AbortController()
process.once('SIGINT',()=>ac.abort())
try {
  // One warm-up outside the measured set; no retry or model search.
  await bot.propose('Say hello',ac.signal)
  const results=[]
  for (const [request,expected] of cases) {
    if(ac.signal.aborted) throw Error('CANCELLED')
    const start=performance.now()
    let actual=null,error=null
    try { actual=(await bot.propose(request,ac.signal)).action }
    catch(e){error=e.message}
    const ms=Math.round(performance.now()-start)
    const result={expected,actual,ms,pass:actual===expected&&!error,error}
    results.push(result)
    console.log(JSON.stringify(result))
  }
  const sorted=results.map(x=>x.ms).sort((a,b)=>a-b)
  const median=(sorted[4]+sorted[5])/2
  console.log(JSON.stringify({model,requests:results.length,correct:results.filter(x=>x.pass).length,medianMs:median,advisoryTargetMet:median<=10000}))
  if(results.some(x=>!x.pass)) process.exitCode=1
} catch(e) {
  console.error(JSON.stringify({error:e.message}))
  process.exitCode=1
}
