# Boujee Peach Headless Feed Renderer

This service renders JavaScript-heavy marketplace feeds such as Temu with Playwright/Chromium and returns product-card JSON to the PHP app.

## Recommended Render.com deployment: Docker Web Service

Render's normal Node service may fail because it cannot install Chromium system dependencies. Use Docker instead.

1. Put the contents of this `render-service` folder in a public GitHub repo, or keep it as the root directory of your existing renderer repo.
2. In Render, create a new **Web Service** from **Public Git Repository**.
3. In the service setup, choose **Docker** runtime/environment if Render asks.
4. Set the root directory to this folder if it is inside a larger repo:

```text
render-service
```

5. Render should detect `Dockerfile`. If it asks for a Dockerfile path, use:

```text
./Dockerfile
```

6. Set the health check path to:

```text
/health/render
```

7. Deploy. After it goes live, open:

```text
https://YOUR-RENDER-URL.onrender.com/health/render
```

It should return JSON with `ok: true`.

8. In Boujee Peach Admin > URL Troubleshooter, paste the base Render URL into **External Renderer URL**, then click **Save/Test Renderer**.

Do not paste `/render-feed` or `/health/render`; paste only the base URL.

## API

- `GET /health`
- `GET /health/render`
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

Then test `http://localhost:3001/health/render`.


## v012 extraction notes

This version adds marketplace-aware rendered extraction:

- Temu detail-link detection for `-g-` and goods/product URLs
- AliExpress/SHEIN selector families
- image-centered card discovery for JS-heavy grids
- autoscroll hydration before extraction
- card scoring and duplicate removal
- debug counts for rendered images, product-like links, and extractor used

If a marketplace renders but returns too few cards, confirm the page is not showing CAPTCHA/verification, then tune the selector family in `feed-renderer.mjs`.
