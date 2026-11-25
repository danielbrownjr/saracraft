# MVP-04 local inference

Issue #29. Proposals only; no Minecraft connection, game action execution, or host changes. Requires Node 22.23.5 and one already-authorized Ollama endpoint/model. No new npm dependencies.

The adapter reuses the bounded response-stream pattern from PR #4, using Ollama native /api/chat and structured JSON output. It accepts literal loopback or RFC1918 IPv4 HTTP endpoints (or IPv6 loopback), no DNS names, redirects, credentials, queries or cloud fallback. A private address is not proof of trusted deployment: the operator must confirm the endpoint belongs to the intended local host. Use loopback where possible, otherwise an authorized trusted private LAN. Requests are bounded to 1000 characters; output body to 16 KiB; deadline to 30 seconds including body reading. Model output is untrusted.

Intents: follow, come, stop, look, collect, chat. Only chat accepts text (1–200 characters, single line, no leading slash). No model-provided coordinates, targets or executable commands. M5 owns authenticated admission, actual observations, deterministic execution and direct STOP bypass. The adapter exposes cancellation but does not operate the bot.

## Offline verification

From controller: `node --test inference/ollama.test.js` or `npm test`. All inference tests use injected fetch fixtures; no network or Ollama needed.

## Actual benchmark (separately authorized endpoint)

Use one installed model chosen for available RAM/compute; record host CPU/RAM, Ollama version, model tag/digest and endpoint locality separately. Before running, confirm the selected model is stored locally (inspect `ollama ls` and `ollama show` on the intended inference host and record its digest). Do not select cloud-backed tags; verify hosted inference is disabled on the intended server, using the installed version's supported controls. A local API endpoint alone does not guarantee local inference. If locality cannot be established, do not benchmark. From controller run:

```sh
SARACRAFT_OLLAMA_MODEL='<installed model tag>' node inference/benchmark.js
```

For an approved private LAN server, additionally set SARACRAFT_OLLAMA_ENDPOINT to its fixed literal private IP and /api/chat path. Do not expose Ollama publicly or install/configure it without approval.

The script records one warm-up (elapsed time and any failure), then ten measured prompts covering all six intents, with no retries. A failed warm-up does not suppress measurements; caller cancellation stops the run. If warm-up failed, subsequent samples may include cold-load time; report that limitation rather than claiming all samples were warm. Confirm that the installed Ollama version/model supports the discriminated `anyOf`/`const` schema on the first real run. It prints expected/actual action, elapsed milliseconds, pass/error and aggregate median. It exits nonzero if any prompt fails; the 10-second median is advisory, not a failure gate. Ctrl-C cancels. No chat contents or credentials are printed. Retain actual results; do not claim measured latency from fixtures. A real model may differ in its structured-output support or response correctness; adjust the chosen model only if the first candidate fails. Stop after the bounded benchmark and report tradeoffs.

M4 remains unaccepted until actual local inference evidence is recorded. No deployment or merge is authorized by this document.

## MVP-05 integration

In supervised-dry mode only, the existing fixed loopback Ollama endpoint and accepted qwen2.5:1.5b model are used for authenticated `!sara ask <request>` messages. No ambient chat activation. Direct deterministic commands remain available, including STOP, which aborts inference and remaining goal steps. Each request permits at most three typed intents; fresh bounded observations and verified result history are supplied before each proposal. Follow remains a continuous action until cancellation. No model-provided targets or coordinates are accepted. Host operator must verify Ollama locality, cloud-disabled configuration, model digest and service reachability before authorized use. No daemon startup is performed by the bot. Offline tests use injected providers; real inference/gameplay evidence is required separately.

### MVP-05 remediation

The attended trial selected look for two follow requests and repeated completed looks. Use explicit intent examples, request/history before rounded observations, and reject repeated completed action types within one goal. A deliberate repeated action needs a fresh request. The same model and execution authority remain unchanged. Controller failure reasons are logged without raw requests. Validate the actual contextual prompts against the installed model offline before another attended session; injected responses cannot establish model accuracy.
