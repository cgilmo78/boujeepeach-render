#!/usr/bin/env node
import process from 'node:process';

const sourceUrl = process.argv[2];
const maxItems = Number(process.argv[3] || 36);
if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
  console.error(JSON.stringify({ error: 'A valid http(s) URL is required.' }));
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error(JSON.stringify({
    error: 'Playwright is not installed for the render service.',
    details: 'Run npm install and npx playwright install chromium on the server, or deploy the render-service folder to a Node worker that has Playwright available.',
  }));
  process.exit(3);
}

function hostType(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('temu')) return 'Temu feed';
    if (host.includes('aliexpress')) return 'AliExpress feed';
    if (host.includes('alibaba')) return 'Alibaba feed';
    if (host.includes('1688')) return '1688 feed';
    if (host.includes('shein')) return 'SHEIN feed';
    if (host.includes('taobao') || host.includes('tmall')) return 'Taobao/Tmall feed';
    return 'Rendered marketplace feed';
  } catch {
    return 'Rendered marketplace feed';
  }
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
} catch (error) {
  console.error(JSON.stringify({
    error: 'Chromium could not launch on the render service.',
    details: error?.message || String(error),
    fix: 'Deploy this renderer as Docker on Render using render-service/Dockerfile. The official Playwright image includes Chromium system dependencies.',
  }));
  process.exit(4);
}

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1600 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    locale: 'en-US',
  });
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9',
  });
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(900);
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const result = await page.evaluate(({ sourceUrl, maxItems }) => {
    const abs = (value) => {
      try { return value ? new URL(value, sourceUrl).toString() : ''; } catch { return ''; }
    };
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const isGoodImage = (value) => /\.(jpe?g|png|webp|avif)(\?|$)/i.test(value || '') || /image|img|thumb|pic|cdn/i.test(value || '');
    const priceFrom = (text) => {
      const match = clean(text).match(/(?:US\s*)?\$\s*([0-9]+(?:[,.][0-9]{1,2})?)|(?:USD|CNY|RMB|¥)\s*([0-9]+(?:[,.][0-9]{1,2})?)/i);
      return match ? Number(String(match[1] || match[2]).replace(',', '')) || 0 : 0;
    };
    const titleFrom = (root) => {
      const attrs = ['title', 'aria-label', 'alt'];
      for (const el of root.querySelectorAll('[title],[aria-label],img[alt]')) {
        for (const attr of attrs) {
          const value = clean(el.getAttribute(attr));
          if (value && value.length >= 8 && value.length <= 180 && !/^shop|store|search|category|best sellers?$/i.test(value)) return value;
        }
      }
      const candidates = [...root.querySelectorAll('h1,h2,h3,[class*=title i],[class*=name i],[data-testid*=title i],span,div,p')]
        .map((el) => clean(el.textContent))
        .filter((v) => v.length >= 12 && v.length <= 180 && !/[{}<>]/.test(v));
      return candidates.sort((a, b) => a.length - b.length)[0] || '';
    };
    const imageFrom = (root) => {
      const img = [...root.querySelectorAll('img,source')]
        .map((el) => el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy') || el.getAttribute('srcset'))
        .map((v) => String(v || '').split(',')[0].trim().split(/\s+/)[0])
        .map(abs)
        .find(isGoodImage);
      return img || '';
    };
    const linkFrom = (root) => {
      const link = root.matches?.('a[href]') ? root : root.querySelector('a[href]');
      return abs(link?.getAttribute('href') || '');
    };
    const rawCards = [];
    const selectors = [
      'a[href*="goods"]','a[href*="item"]','a[href*="product"]','a[href*="/p/"]',
      '[data-testid*="product" i]','[class*="product" i]','[class*="goods" i]','[class*="item" i]','[class*="card" i]','li','article'
    ];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = clean(node.textContent);
        const img = imageFrom(node);
        const price = priceFrom(text);
        const url = linkFrom(node);
        if ((img || price || /item|goods|product|\/p\//i.test(url)) && text.length >= 8) rawCards.push(node);
      }
      if (rawCards.length >= maxItems * 2) break;
    }
    const seenNodes = new Set();
    const items = [];
    const seenKeys = new Set();
    for (const node of rawCards) {
      if (seenNodes.has(node)) continue;
      seenNodes.add(node);
      const name = titleFrom(node);
      const image = imageFrom(node);
      const price = priceFrom(node.textContent || '');
      const url = linkFrom(node) || sourceUrl;
      if (!name || /^shop|store|search|category|best sellers?|homepage|marketplace$/i.test(name)) continue;
      if (!image && !price && url === sourceUrl) continue;
      const key = `${name.toLowerCase()}|${image}|${url}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push({ name, title: name, image, price, sourcePrice: price, detailUrl: url, url });
      if (items.length >= maxItems) break;
    }
    return {
      title: document.title || '',
      htmlLength: document.documentElement.outerHTML.length,
      itemCount: items.length,
      items,
      blocked: /captcha|access denied|verify you are human|robot check/i.test(document.body?.innerText || ''),
    };
  }, { sourceUrl, maxItems });

  console.log(JSON.stringify({
    ok: true,
    mode: 'rendered-feed',
    feedMode: true,
    rendered: true,
    marketplaceType: hostType(sourceUrl),
    sourceUrl,
    ...result,
  }));
} catch (error) {
  console.error(JSON.stringify({ error: 'Headless render failed.', details: error?.message || String(error) }));
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
}
