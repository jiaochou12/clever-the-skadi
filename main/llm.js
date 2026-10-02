// OpenAI 兼容接口的流式对话代理：在主进程发起请求，规避渲染进程 CORS 限制
const active = new Map(); // id -> { ac, timedOut }
let nextId = 1;

const CHAT_IDLE_TIMEOUT = Number(process.env.SKADIPET_CHAT_TIMEOUT_MS) || 90000;  // 聊天：连续 90 秒收不到任何数据则断开
const TEST_TIMEOUT = Number(process.env.SKADIPET_TEST_TIMEOUT_MS) || 60000;       // 测试连接：60 秒无响应视为失败

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
  try {
    const res = await fetch(endpoint(cfg), {
      method: 'POST',
      signal: ac.signal,
      headers: headers(cfg),
      body: JSON.stringify(buildBody(cfg, full, true))
    });
    armGuard();
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
          if (!data || data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const d = (j.choices && j.choices[0] && ((j.choices[0].delta && j.choices[0].delta.content) || (j.choices[0].message && j.choices[0].message.content))) || '';
            if (d) win.webContents.send('llm:chunk', { id, delta: d });
          } catch (e) { /* 忽略无法解析的行 */ }
        }
      }
    } else {
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '（空回复）';
      win.webContents.send('llm:chunk', { id, delta: text });
    }
    win.webContents.send('llm:done', { id });
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
    } else {
      win.webContents.send('llm:error', { id, message: String((e && e.message) || e) });
    }
  } finally {
    clearTimeout(guard);
    active.delete(id);
  }
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
    return { ok: false, message: String((e && e.message) || e) };
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

module.exports = { chat, test, abortAll, nextId: () => nextId++ };
