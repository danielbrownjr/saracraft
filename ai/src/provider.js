// Narrow OpenAI-compatible provider. Configuration is trusted, model output is not.
export class ChatProvider {
  #endpoint; #model; #key; #fetch; #timeoutMs; #maxTokens;
  constructor({ endpoint, model, apiKey = '', fetchImpl = fetch, timeoutMs = 12000, maxTokens = 180 }) {
    let url;
    try { url = new URL(endpoint); } catch { throw Error('INVALID_ENDPOINT'); }
    if (url.username || url.password || url.search || url.hash ||
      !['https:','http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('UNSAFE_ENDPOINT');
    if (!url.pathname.endsWith('/chat/completions')) throw Error('INVALID_ENDPOINT_PATH');
    if (typeof model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,100}$/.test(model)) throw Error('INVALID_MODEL');
    if (typeof fetchImpl !== 'function') throw Error('INVALID_FETCH');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Error('INVALID_TIMEOUT');
    if (!Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 512) throw Error('INVALID_TOKEN_LIMIT');
    this.#endpoint=url.toString(); this.#model=model; this.#key=apiKey; this.#fetch=fetchImpl;
    this.#timeoutMs=timeoutMs; this.#maxTokens=maxTokens;
  }
  async complete(messages, signal) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 3 ||
      messages.some(m => !['system','user'].includes(m?.role) || typeof m.content !== 'string' || m.content.length > 1200)) throw Error('INVALID_MESSAGES');
    const ac=new AbortController();
    const timer=setTimeout(()=>ac.abort(),this.#timeoutMs);
    const abort=()=>ac.abort();
    if (signal?.aborted) ac.abort();
    signal?.addEventListener('abort',abort,{once:true});
    try {
      const response=await this.#fetch(this.#endpoint,{method:'POST',signal:ac.signal,
        headers:{'Content-Type':'application/json',...(this.#key?{Authorization:`Bearer ${this.#key}`}:{})},
        body:JSON.stringify({model:this.#model,messages,stream:false,temperature:0,
          max_tokens:this.#maxTokens,response_format:{type:'json_object'}})});
      if (!response.ok) throw Error('PROVIDER_FAILURE');
      const raw=await response.text();
      if (raw.length > 16384) throw Error('RESPONSE_TOO_LARGE');
      let data;
      try { data=JSON.parse(raw); } catch { throw Error('INVALID_PROVIDER_JSON'); }
      const content=data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length > 2048) throw Error('INVALID_MODEL_RESPONSE');
      return content;
    } catch(error) {
      if (ac.signal.aborted) throw Error('PROVIDER_TIMEOUT_OR_CANCELLED');
      if (['PROVIDER_FAILURE','RESPONSE_TOO_LARGE','INVALID_PROVIDER_JSON','INVALID_MODEL_RESPONSE'].includes(error.message)) throw error;
      throw Error('PROVIDER_UNAVAILABLE');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
  }
}
