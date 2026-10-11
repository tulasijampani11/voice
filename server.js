// TJ voice agent: tiny server, no dependencies. Needs Node 18 or newer.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;
const GKEY = process.env.GEMINI_API_KEY; // free option from Google AI Studio
const MODEL = process.env.MODEL || (GKEY ? 'gemini-2.5-flash-lite' : 'claude-sonnet-5-5');
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const OWNER = process.env.OWNER_NAME || 'Tulsi Jhampani';
const ABOUT = process.env.ABOUT || '';
const TTS_MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'Kore';
const TTS_STYLE = process.env.TTS_STYLE !== undefined ? process.env.TTS_STYLE : 'Say in a soft, sweet, gentle voice: ';
const TIMEZONE = process.env.TIMEZONE || 'America/Chicago';
const LOCATION = process.env.LOCATION || '';

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
    'Right now it is ' + nowText() + ' (' + TIMEZONE + ').',
    LOCATION ? 'The person is located in ' + LOCATION + '.' : '',
    'For weather, news, or other live facts, use the search tool. If the place is unclear for weather, ask which city.',
    ABOUT ? 'Background about ' + OWNER + ': ' + ABOUT : ''
  ].filter(Boolean).join('\n');
}

function nowText() {
  try {
    return new Date().toLocaleString('en-US', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' });
  } catch (e) {
    return new Date().toUTCString();
  }
}

async function geminiChat(lang, messages, withSearch) {
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt(lang) }] },
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: 1024 }
  };
  if (withSearch) payload.tools = [{ google_search: {} }];
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  return { ok: r.ok, status: r.status, data };
}

function geminiText(data) {
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map(p => p.text || '').join('\n').trim();
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

// Wrap raw 16-bit mono PCM (24 kHz) from Gemini TTS into a WAV file the browser can play.
function wavFromPcm(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Small script added to the page: speaks replies with the built-in server voice,
// and falls back to the device voice if the server voice is unavailable.
const VOICE_SHIM = `<script>
(function(){
  var ss = window.speechSynthesis;
  if(!ss) return;
  var realCancel = ss.cancel.bind(ss);
  var cur = null, token = 0;
  ss.speak = function(u){
    var my = ++token;
    var code = '';
    try{ code = localStorage.getItem('tj_code') || ''; }catch(e){}
    function done(){ if(my === token && u.onend) u.onend(); }
    function attempt(n){
      fetch('/api/tts', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-access-code': code},
        body: JSON.stringify({text: u.text, lang: u.lang})
      }).then(function(r){
        if(!r.ok) throw new Error('tts');
        return r.blob();
      }).then(function(b){
        if(my !== token) return;
        var a = new Audio(URL.createObjectURL(b));
        cur = a;
        a.onended = function(){ cur = null; done(); };
        a.onerror = function(){ cur = null; done(); };
        return a.play();
      }).catch(function(){
        if(my !== token) return;
        if(n < 2){ setTimeout(function(){ if(my === token) attempt(n + 1); }, 700); }
        else { done(); }
      });
    }
    attempt(0);
  };
  ss.cancel = function(){
    token++;
    if(cur){ try{ cur.pause(); }catch(e){} cur = null; }
    try{ realCancel(); }catch(e){}
  };
  var n = document.getElementById('notice');
  if(n){
    new MutationObserver(function(){
      if(n.textContent.indexOf('No Telugu voice') === 0) n.textContent = '';
    }).observe(n, {childList: true, characterData: true, subtree: true});
  }
})();
</script>`;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
        .replace('text.split(/(?<=[.!?\\u0964])\\s+/).filter(Boolean)', '[text]')
        .replace('</body>', VOICE_SHIM + '</body>');
      return send(res, 200, page, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!KEY && !GKEY) return send(res, 500, { error: 'Server is missing GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.' });
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

      let text = '';
      if (GKEY) {
        let g = await geminiChat(lang, messages, true);
        if (!g.ok) {
          console.error('Gemini search error (retrying without search):', JSON.stringify(g.data));
          g = await geminiChat(lang, messages, false);
        }
        if (!g.ok) {
          console.error('Gemini error:', JSON.stringify(g.data));
          return send(res, 502, { error: g.status === 429 ? 'Free limit reached. Wait a minute and try again.' : 'The AI service returned an error.' });
        }
        text = geminiText(g.data);
        if (!text) {
          console.error('Gemini empty reply:', JSON.stringify(g.data).slice(0, 600));
          text = lang === 'te-IN'
            ? 'క్షమించండి, సమాధానం దొరకలేదు. దయచేసి మళ్లీ అడగండి.'
            : 'Sorry, I could not come up with an answer. Please ask again.';
        }
      } else {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODEL, max_tokens: 400, system: systemPrompt(lang), messages })
        });
        const data = await r.json();
        if (!r.ok) {
          console.error('Anthropic error:', JSON.stringify(data));
          return send(res, 502, { error: 'The AI service returned an error.' });
        }
        text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      }
      return send(res, 200, { text });
    }

    if (req.method === 'POST' && req.url === '/api/tts') {
      if (!GKEY) return send(res, 501, { error: 'Server voice needs GEMINI_API_KEY.' });
      if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
        return send(res, 401, { error: 'Wrong access code.' });
      }
      const body = JSON.parse(await readBody(req));
      const text = String(body.text || '').slice(0, 1500).trim();
      if (!text) return send(res, 400, { error: 'No text.' });
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + TTS_MODEL + ':generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: TTS_STYLE + text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } }
          }
        })
      });
      const data = await r.json();
      if (!r.ok) {
        console.error('TTS error:', JSON.stringify(data));
        return send(res, 502, { error: 'Voice service error.' });
      }
      const part = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const inline = (part[0] || {}).inlineData;
      if (!inline || !inline.data) {
        console.error('TTS error: no audio in response');
        return send(res, 502, { error: 'No audio returned.' });
      }
      const wav = wavFromPcm(Buffer.from(inline.data, 'base64'), 24000);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
      return res.end(wav);
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, () => console.log('TJ is running on port ' + PORT));
