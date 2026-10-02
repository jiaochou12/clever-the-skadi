// OpenAI 兼容接口的流式对话代理：在主进程发起请求，规避渲染进程 CORS 限制
const active = new Map(); // id -> { ac, timedOut }
let nextId = 1;

const CHAT_IDLE_TIMEOUT = Number(process.env.SKADIPET_CHAT_TIMEOUT_MS) || 90000;  // 聊天：连续 90 秒收不到任何数据则断开
const TEST_TIMEOUT = Number(process.env.SKADIPET_TEST_TIMEOUT_MS) || 60000;       // 测试连接：60 秒无响应视为失败
const WARM_TIMEOUT = 5000;                                                        // 预热请求超时（失败静默忽略）

function buildBody(cfg, messages, stream, extra = {}) {
  const { model, temperature } = cfg.api;
  const body = { model, messages, stream, temperature: Number(temperature) || 0.8 };
  return Object.assign(body, extra);
}

function headers(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.api.apiKey) h['Authorization'] = `Bearer ${cfg.api.apiKey}`;
  return h;
}

function endpoint(cfg) {
  return cfg.api.baseUrl.replace(/\/+$/, '') + '/chat/completions';
}

function checkConfig(cfg) {
  if (!cfg.api.baseUrl) return '请先在设置中填写 API 地址（Base URL）';
  if (!cfg.api.model) return '请先在设置中填写模型名称';
  return null;
}

// 从 SSE 分块里取正文/思考流/结束原因
// 思考流字段：deepseek-r1 用 reasoning_content，OpenRouter 等用 reasoning
function pickDelta(j) {
  const c = j.choices && j.choices[0];
  if (!c) return null;
  const d = c.delta || c.message || {};
  return {
    content: d.content || '',
    reasoning: d.reasoning_content || d.reasoning || '',
    finish: c.finish_reason || null
  };
}

// 把底层网络错误翻译成可读提示
function friendlyError(e) {
  // Node 20 fetch：cause 可能是 AggregateError（Happy Eyeballs），真实 code 在 errors[0]
  const code = (e && e.cause && e.cause.code) ||
    (e && e.cause && Array.isArray(e.cause.errors) && e.cause.errors[0] && e.cause.errors[0].code) || '';
  if (code === 'ECONNREFUSED') return '无法连接到 API 服务器（连接被拒绝），请检查接口地址与网络/代理';
  if (code === 'ENOTFOUND') return '无法解析 API 域名，请检查接口地址是否正确';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return '连接 API 服务器超时，请检查网络或代理';
  const s = String((e && e.message) || e);
  if (s.includes('terminated')) return '连接被中断（网络不稳定或服务端断开）';
  return s;
}

async function chat({ cfg, messages, win, id }) {
  const err = checkConfig(cfg);
  if (err) {
    win.webContents.send('llm:error', { id, message: err });
    return;
  }
  const ac = new AbortController();
  const state = { ac, timedOut: false };
  active.set(id, state);
  // 空闲保护：等响应头、流中每个分块都会重置计时；超时主动断开并给出可读提示
  let guard = null;
  const armGuard = () => {
    clearTimeout(guard);
    guard = setTimeout(() => {
      state.timedOut = true;
      try { ac.abort(); } catch (e) {}
    }, CHAT_IDLE_TIMEOUT);
  };
  armGuard();
  const full = [{ role: 'system', content: cfg.api.systemPrompt || '' }, ...messages].filter(m => m.content);
  const url = endpoint(cfg);
  const mkInit = () => ({
    method: 'POST',
    signal: ac.signal,
    headers: headers(cfg),
    body: JSON.stringify(buildBody(cfg, full, true))
  });

  let sentContent = false;   // 是否已发出正文（中途断网时保留半截内容而非报错覆盖）
  let sawDone = false;       // 收到 [DONE]
  let finishReason = null;   // finish_reason：length = 被长度上限截断
  try {
    let res = null;
    // 首字节前的连接类失败自动重试一次；流一旦开始就不能重试（会重复输出）
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      armGuard();
      try {
        res = await fetch(url, mkInit());
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (attempt > 0) throw e;
      }
    }
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`HTTP ${res.status} ${t}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('event-stream') && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        armGuard();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') { sawDone = true; continue; }
          try {
            const d = pickDelta(JSON.parse(data));
            if (!d) continue;
            if (d.finish) finishReason = d.finish;
            if (d.reasoning) win.webContents.send('llm:chunk', { id, delta: d.reasoning, kind: 'reasoning' });
            if (d.content) {
              sentContent = true;
              win.webContents.send('llm:chunk', { id, delta: d.content });
            }
          } catch (e) { /* 忽略无法解析的行 */ }
        }
      }
    } else {
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '（空回复）';
      finishReason = (j.choices && j.choices[0] && j.choices[0].finish_reason) || 'stop';
      if (text && text !== '（空回复）') sentContent = true;
      win.webContents.send('llm:chunk', { id, delta: text });
    }
    win.webContents.send('llm:done', {
      id,
      truncated: finishReason === 'length',
      interrupted: sentContent && !sawDone && !finishReason
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (state.timedOut) {
        win.webContents.send('llm:error', {
          id,
          message: `响应超时（${Math.round(CHAT_IDLE_TIMEOUT / 1000)} 秒没有收到任何数据），API 服务可能不可用或太慢`
        });
      } else {
        win.webContents.send('llm:done', { id, aborted: true });
      }
    } else if (sentContent) {
      // 流中途断网：保留已收到的部分正文，提示中断
      win.webContents.send('llm:done', { id, interrupted: true });
    } else {
      win.webContents.send('llm:error', { id, message: friendlyError(e) });
    }
  } finally {
    clearTimeout(guard);
    active.delete(id);
  }
}

// 预热连接：提前完成 DNS/TCP/TLS 握手，降低下一条消息的首字延迟（失败静默忽略）
async function warm(cfg) {
  if (checkConfig(cfg)) return;
  try {
    await fetch(endpoint(cfg).replace(/\/chat\/completions$/, '/models'), {
      signal: AbortSignal.timeout(WARM_TIMEOUT),
      headers: headers(cfg)
    });
  } catch (e) { /* 预热失败不影响正常对话 */ }
}

async function test(cfg) {
  const err = checkConfig(cfg);
  if (err) return { ok: false, message: err };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TEST_TIMEOUT);
  try {
    const t0 = Date.now();
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      signal: ac.signal,
      headers: headers(cfg),
      body: JSON.stringify(buildBody(cfg, [
        { role: 'system', content: 'you are a ping server' },
        { role: 'user', content: '请只回复：ok' }
      ], false, { max_tokens: 16 }))
    });
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 300);
      return { ok: false, message: `HTTP ${res.status} ${t}` };
    }
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { ok: true, message: `连接成功（${Date.now() - t0}ms）：${String(text).trim().slice(0, 50)}` };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      return { ok: false, message: `连接超时（${Math.round(TEST_TIMEOUT / 1000)} 秒无响应），API 服务不可用或太慢` };
    }
    return { ok: false, message: friendlyError(e) };
  } finally {
    clearTimeout(timer);
  }
}

function abortAll() {
  for (const { ac } of active.values()) {
    try { ac.abort(); } catch (e) {}
  }
  active.clear();
}

module.exports = { chat, test, warm, abortAll, nextId: () => nextId++ };
