// 测试用 mock LLM 服务器：OpenAI 兼容，支持流式 SSE，端口 18787
const http = require('http');

const REPLY = '测试成功！我是斯卡蒂，深海猎人已就位。这条回复来自本地 mock 服务器，用来验证对话链路。';

http.createServer((req, res) => {
  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404);
    return res.end('not found');
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch (e) {}
    const auth = req.headers.authorization || '';
    console.log('[mock] request: model=%s stream=%s auth=%s msgs=%d',
      parsed.model, parsed.stream, auth.slice(0, 12), (parsed.messages || []).length);
    if (parsed.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const chunks = REPLY.match(/.{1,6}/g) || [REPLY];
      let i = 0;
      const timer = setInterval(() => {
        if (i < chunks.length) {
          const payload = { choices: [{ delta: { content: chunks[i] } }] };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
          i++;
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(timer);
        }
      }, 60);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
    }
  });
}).listen(18787, '127.0.0.1', () => console.log('[mock] listening on http://127.0.0.1:18787'));
