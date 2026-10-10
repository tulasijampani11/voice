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
  var realSpeak = ss.speak.bind(ss), realCancel = ss.cancel.bind(ss);
  var cur = null, token = 0;
  function fallback(u){ try{ realSpeak(u); }catch(e){ if(u.onend) u.onend(); } }
  ss.speak = function(u){
    var my = ++token;
    var code = '';
    try{ code = localStorage.getItem('tj_code') || ''; }catch(e){}
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
      a.onended = function(){ cur = null; if(u.onend) u.onend(); };
      a.onerror = function(){ cur = null; fallback(u); };
      return a.play();
    }).catch(function(){ if(my === token) fallback(u); });
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
      const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('</body>', VOICE_SHIM + '</body>');
      return send(res, 200, page, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!KEY && !GKEY) return send(res, 500, { error: 'Server is missing GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.' });
      if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
        return send(res, 401, { error: 'Wrong access code.' });
      }
      const body = JSON.parse(await
