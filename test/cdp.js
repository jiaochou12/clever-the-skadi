// CDP 调试工具：node test/cdp.js "<js 表达式>" [截图输出.png]
const port = process.argv[2] || 9333;
const expr = process.argv[3];
const shot = process.argv[4];
const titleFilter = process.argv[5] || '';

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = titleFilter
    ? list.find((t) => t.type === 'page' && t.title.includes(titleFilter))
    : list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));

  if (expr) {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    console.log(JSON.stringify(r.result, null, 1).slice(0, 4000));
  }
  if (shot) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shot, Buffer.from(r.data, 'base64'));
    console.log('screenshot saved: ' + shot);
  }
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('CDP error:', e.message);
  process.exit(1);
});
