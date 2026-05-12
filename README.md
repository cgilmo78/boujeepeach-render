# Boujee Peach Headless Feed Renderer

This Node/Playwright worker renders JavaScript-heavy marketplace feeds such as Temu, scrolls the hydrated page, and returns product-card JSON to the PHP app.

## No-SSH deployment: Render.com

1. Create a new Render Web Service from this project/repo.
2. Use the included `render.yaml`, or set these values manually:
   - Root directory: `render-service`
   - Build command: `npm install && npx playwright install chromium`
   - Start command: `npm start`
   - Health check path: `/health`
3. After deploy, copy the Render service URL, for example `https://your-service.onrender.com`.
4. In Boujee Peach Admin > URL Troubleshooter, paste that URL into **External Renderer URL**, then click **Save/Test Renderer**.
5. Click **Preview Feed** on a Temu/AliExpress/SHEIN feed URL.

## API

- `GET /health`
- `POST /render-feed` with JSON:

```json
{ "sourceUrl": "https://www.temu.com/...", "maxItems": 36 }
```

## Local test

```bash
npm install
npx playwright install chromium
npm start
```

Then test `http://localhost:3001/health`.

If your PHP host supports SSH and `proc_open`, the PHP app can still run `feed-renderer.mjs` locally. If not, set the external renderer URL in the admin UI.
