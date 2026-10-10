// TJ voice agent: tiny server, no dependencies. Needs Node 18 or newer.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const OWNER = process.env.OWNER_NAME || 'Tulsi Jhampani';
const ABOUT = process.env.ABOUT || '';

function systemPrompt(lang) {
  const reply = lang === 'te-IN'
    ? 'Always reply in Telugu, written in Telugu script (తెలుగు).'
    : 'Reply in English.';
  return [
    'You are TJ, a friendly personal voice assistant created for ' + OWNER + '. TJ stands for Tulsi Jhampani.',
    'You are speaking out loud in a real-time conversation, like a helpful friend.',
    reply,
    'Keep answers short: one to three sentences unless asked for more.',
    'Use plain spoken language only. No markdown, no bullet points, no emojis, no special symbols.',
    'If you did not understand, ask the person to repeat it. Never claim to be human.',
    ABOUT ? 'Background about ' + OWNER + ': ' + ABOUT : ''
  ].filter(Boolean).join('\n');
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!KEY) return send(res, 500, { error: 'Server is missing ANTHROPIC_API_KEY.' });
      if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
        return send(res, 401, { error: 'Wrong access code.' });
      }
      const body = JSON.parse(await readBody(req));
      const lang = body.lang === 'en-IN' ? 'en-IN' : 'te-IN';
      const messages = (Array.isArray(body.messages) ? body.messages : [])
        .slice(-20)
        .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) }));
      if (!messages.length || messages[messages.length - 1].role !== 'user') {
        return send(res, 400, { error: 'Send a user message.' });
      }

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 400, system: systemPrompt(lang), messages })
      });
      const data = await r.json();
      if (!r.ok) {
        console.error('Anthropic error:', JSON.stringify(data));
        return send(res, 502, { error: 'The AI service returned an error.' });
      }
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return send(res, 200, { text });
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, () => console.log('TJ is running on port ' + PORT));
