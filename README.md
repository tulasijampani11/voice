# TJ voice agent

Open the page, tap the circle once, and talk. TJ listens, answers out loud, then listens again, with no typing.
It works in Telugu (default) and English.

## Try it on your computer first (5 minutes)

1. Install Node.js 18 or newer from nodejs.org.
2. Get an API key at console.anthropic.com (this has usage costs, so add a small budget).
3. In this folder, run:

   Mac / Linux:
   ```
   ANTHROPIC_API_KEY=your-key-here node server.js
   ```
   Windows (PowerShell):
   ```
   $env:ANTHROPIC_API_KEY="your-key-here"; node server.js
   ```
4. Open http://localhost:3000 in Chrome, tap the circle, allow the microphone, and speak.

## Put it online so it works on your phone

The microphone only works on secure (https) sites, so use a host that gives you https.
Render.com, Railway, and Fly.io all work. With Render:

1. Put this folder in a GitHub repository.
2. On Render, create a new **Web Service** from that repository.
3. Start command: `node server.js` (no build command needed).
4. Add these environment variables:
   - `ANTHROPIC_API_KEY`: your key (required)
   - `ACCESS_CODE`: a password only you know, so strangers cannot spend your money (strongly recommended)
   - `OWNER_NAME`: Tulsi Jhampani (optional)
   - `ABOUT`: a few sentences about you, if TJ should answer questions about you (optional)
5. Open your Render address on your phone in Chrome, type the access code at the top right, tap the circle, and talk.

On Android, Chrome menu > **Add to Home screen** puts TJ on your home screen like an app.

## Good to know

- Telugu listening works best in Chrome on Android. iPhone Safari support for voice input is limited.
- Your phone needs a Telugu text-to-speech voice for TJ to speak Telugu (Settings > Text-to-speech). If none is installed, TJ shows the answer as text.
- Never share your API key or put it in the web page. Only the server (`server.js`) should have it.
- To change the model, set the `MODEL` environment variable.
