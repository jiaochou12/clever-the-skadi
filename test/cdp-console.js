// 监听页面 console 输出：node test/cdp-console.js [秒数]
const port = process.argv[2] || 9333;
const seconds = Number(process.argv[3] || 8);

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: ++msgId, method: 'Runtime.enable', params: {} }));
    ws.send(JSON.stringify({ id: ++msgId, method: 'Page.enable', params: {} }));
    ws.send(JSON.stringify({ id: ++msgId, method: 'Page.reload', params: {} }));
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      const { type, args } = m.params;
      const text = args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      console.log(`[${type}] ${text.slice(0, 500)}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      console.log(`[exception] ${(d.exception && (d.exception.description || d.exception.value)) || d.text}`.slice(0, 500));
    }
  };
  setTimeout(() => process.exit(0), seconds * 1000);
}

main().catch((e) => { console.error('CDP error:', e.message); process.exit(1); });
