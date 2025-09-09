// llm_stream_bench.js
import sse from 'k6/x/sse';
import { Trend, Counter } from 'k6/metrics';

export const options = {
    vus: Number(__ENV.VUS || 5),
    duration: __ENV.DURATION || '30s',
};

const ttft_s = new Trend('ttft_s');            // Time to first token
const tbt_chunk_s = new Trend('tbt_chunk_s');       // Time between streamed chunks (fallback)
const tbt_token_s = new Trend('tbt_token_s');       // Time between tokens (if tokens are exposed)
const toks_total = new Counter('completion_tokens');
const toks_per_sec = new Trend('tokens_per_sec');

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8000/v1';
const MODEL = __ENV.MODEL || 'gpt-oss-20b';
const AUTH = __ENV.TOKEN || '';                   // Bearer token if needed

export default function () {
    const payload = {
        model: MODEL,
        stream: true,
        // If your server supports it, this gives you a final "usage" event.
        stream_options: { include_usage: true },
        // Optional: enable logprobs to expose tokens in-stream (server support varies).
        // logprobs: true, top_logprobs: 0,

        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Write a haiku about streaming tokens.' },
        ],
        max_tokens: 128,
        temperature: 0,
    };

    const params = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(AUTH ? { Authorization: `Bearer ${AUTH}` } : {}),
        },
        body: JSON.stringify(payload),
    };

    const t0 = Date.now();
    let tFirst = 0;
    let tPrev = 0;

    // For macro tokens/sec
    let completionTokens = 0;
    let tEnd = 0;

    // For true per-token timing when server streams token info
    let tokenModeSeen = false;

    const res = sse.open(`${BASE}/chat/completions`, params, (client) => {
        client.on('event', (ev) => {
            const now = Date.now();
            const data = (ev && ev.data ? String(ev.data).trim() : '');

            // Ignore keepalives / empty frames / stream terminator
            if (!data || data === '[DONE]' || data.startsWith(':')) return;

            // First chunk -> TTFT
            if (!tFirst) {
                tFirst = now;
                tPrev = now;
                ttft_s.add((tFirst - t0) / 1e3);
            } else {
                // Per-chunk delta (always available)
                tbt_chunk_s.add((now - tPrev) / 1e3);
                tPrev = now;
            }

            // Only parse JSON if it looks like JSON
            if (data[0] !== '{') return;

            let chunk;
            try { chunk = JSON.parse(data); }
            catch { return; } // tolerate split/partial frames from proxies

            // Usage event (when you set stream_options.include_usage=true)
            if (chunk.usage && Number.isFinite(chunk.usage.completion_tokens)) {
                completionTokens = chunk.usage.completion_tokens;
                tEnd = now;
                return;
            }

            // Try token-level timing if your backend exposes tokens/logprobs in-stream
            const choice = chunk?.choices?.[0];
            const tokenObjs =
                choice?.logprobs?.content           // OpenAI-style streamed token list (if enabled)
                || choice?.logprobs?.tokens            // some gateways
                || null;

            if (tokenObjs && tokenObjs.length) {
                for (let i = 0; i < tokenObjs.length; i++) {
                    const tNow = Date.now();
                    if (tNow > tPrev) tbt_token_s.add((tNow - tPrev) / 1e3);
                    tPrev = tNow;
                    toks_total.add(1);
                }
            }
        });

        client.on('error', (e) => {
            // k6 will mark the iteration as failed if you throw
            throw e;
        });
    });

    // Macro tokens/sec from first chunk to end of stream (requires tFirst/tEnd and token count)
    if (tFirst && tEnd && completionTokens > 0) {
        const genMs = tEnd - tFirst;
        if (genMs > 0) toks_per_sec.add(completionTokens / (genMs / 1e3));
    }

    // Optional: assert success
    if (res?.status !== 200) {
        throw new Error(`HTTP ${res?.status} from ${BASE}/chat/completions`);
    }
}
