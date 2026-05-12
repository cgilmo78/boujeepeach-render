#!/usr/bin/env node
import process from 'node:process';

const sourceUrl = process.argv[2];
const maxItems = Math.max(1, Math.min(80, Number(process.argv[3] || 36)));
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
    details: 'Deploy the render-service folder as a Docker web service using the included Dockerfile.',
  }));
  process.exit(3);
}

function marketplaceType(url) {
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

function marketplaceKey(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('temu')) return 'temu';
    if (host.includes('aliexpress')) return 'aliexpress';
    if (host.includes('alibaba')) return 'alibaba';
    if (host.includes('1688')) return '1688';
    if (host.includes('shein')) return 'shein';
    if (host.includes('taobao') || host.includes('tmall')) return 'taobao';
    return 'generic';
  } catch {
    return 'generic';
  }
}

async function dismissOverlays(page) {
  const labels = [
    'accept', 'agree', 'continue', 'not now', 'close', 'x', 'no thanks', 'skip', 'allow all'
  ];
  for (const text of labels) {
    try {
      await page.getByText(new RegExp(`^${text}$`, 'i')).first().click({ timeout: 600 });
      await page.waitForTimeout(400);
    } catch {}
  }
  try { await page.keyboard.press('Escape'); } catch {}
}

async function hydrateFeed(page) {
  await page.waitForTimeout(2500);
  await dismissOverlays(page);
  const scrollSteps = [600, 1000, 1400, 1800, 2200, 2600, 3000, 3600, 4200, 5000];
  for (const y of scrollSteps) {
    await page.evaluate((to) => window.scrollTo({ top: to, behavior: 'instant' }), y).catch(() => {});
    await page.waitForTimeout(850);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
  await page.waitForTimeout(900);
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 1300).catch(() => {});
    await page.waitForTimeout(800);
  }
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
} catch (error) {
  console.error(JSON.stringify({
    error: 'Chromium could not launch on the render service.',
    details: error?.message || String(error),
    fix: 'Deploy this renderer as Docker on Render using render-service/Dockerfile.',
  }));
  process.exit(4);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'accept-language': 'en-US,en;q=0.9' },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await hydrateFeed(page);

  const result = await page.evaluate(({ sourceUrl, maxItems, marketplace }) => {
    const abs = (value) => {
      try { return value ? new URL(value, sourceUrl).toString() : ''; } catch { return ''; }
    };
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 20 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) !== 0;
    };
    const imgUrl = (el) => {
      const values = [
        el.currentSrc,
        el.src,
        el.getAttribute?.('src'),
        el.getAttribute?.('data-src'),
        el.getAttribute?.('data-original'),
        el.getAttribute?.('data-lazy'),
        el.getAttribute?.('data-srcset'),
        el.getAttribute?.('srcset'),
      ].filter(Boolean);
      for (const raw of values) {
        const first = String(raw).split(',')[0].trim().split(/\s+/)[0];
        const out = abs(first);
        if (out && !/^data:/i.test(out) && !/sprite|logo|avatar|icon|blank|placeholder/i.test(out)) return out;
      }
      const bg = getComputedStyle(el).backgroundImage || '';
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/i);
      return m ? abs(m[1]) : '';
    };
    const goodImage = (url) => !!url && (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(url) || /img|image|thumb|pic|goods|product|cdn|alicdn|temu|shein|ae01/i.test(url));
    const priceText = (text) => {
      const t = clean(text);
      const patterns = [
        /(?:US\s*)?\$\s*([0-9]{1,5}(?:[,.][0-9]{1,2})?)/i,
        /(?:USD|CNY|RMB|AUD|CAD|GBP|EUR)\s*([0-9]{1,5}(?:[,.][0-9]{1,2})?)/i,
        /[¥€£]\s*([0-9]{1,5}(?:[,.][0-9]{1,2})?)/i,
      ];
      for (const p of patterns) {
        const m = t.match(p);
        if (m) return `$${m[1]}`;
      }
      return '';
    };
    const priceNumber = (text) => {
      const p = priceText(text);
      const m = p.match(/[0-9]{1,5}(?:[,.][0-9]{1,2})?/);
      return m ? Number(m[0].replace(',', '')) || 0 : 0;
    };
    const detailLike = (url) => {
      if (!url) return false;
      if (marketplace === 'temu') return /goods|product|item|\/[^/?#]+-g-\d+/i.test(url);
      if (marketplace === 'aliexpress') return /item\/|\/i\/|product/i.test(url);
      if (marketplace === 'shein') return /\/p-|product|goods/i.test(url);
      return /goods|product|item|detail|\/p\//i.test(url);
    };
    const bestLink = (root) => {
      const links = [];
      if (root.matches?.('a[href]')) links.push(root);
      links.push(...root.querySelectorAll?.('a[href]') || []);
      const mapped = links.map((a) => abs(a.getAttribute('href'))).filter(Boolean);
      return mapped.find(detailLike) || mapped.find((u) => !/login|cart|search|category|support|policy|help/i.test(u)) || '';
    };
    const textCandidates = (root, imageAlt = '') => {
      const out = [];
      const add = (v) => {
        v = clean(v);
        if (!v || v.length < 8 || v.length > 220) return;
        if (/^(shop|store|search|category|best sellers?|homepage|marketplace|sponsored|ad|free shipping|add to cart|view details)$/i.test(v)) return;
        if (/^\$?\d+(\.\d+)?$/.test(v)) return;
        if (/[{}<>]/.test(v)) return;
        out.push(v);
      };
      add(imageAlt);
      for (const el of root.querySelectorAll?.('[title],[aria-label],img[alt],h1,h2,h3,[class*=title i],[class*=name i],[class*=goods i],[data-testid*=title i],span,div,p') || []) {
        add(el.getAttribute?.('title'));
        add(el.getAttribute?.('aria-label'));
        add(el.getAttribute?.('alt'));
        const txt = clean(el.textContent);
        if (txt && txt !== clean(root.textContent) && txt.length <= 220) add(txt);
      }
      const whole = clean(root.textContent).replace(priceText(root.textContent), '').trim();
      add(whole);
      return [...new Set(out)].sort((a, b) => {
        const ap = /shoe|sneaker|dress|bag|women|men|kids|set|piece|fashion|casual|summer|winter/i.test(a) ? -20 : 0;
        const bp = /shoe|sneaker|dress|bag|women|men|kids|set|piece|fashion|casual|summer|winter/i.test(b) ? -20 : 0;
        return (Math.abs(a.length - 58) + ap) - (Math.abs(b.length - 58) + bp);
      });
    };
    const meaningfulAncestor = (node) => {
      let cur = node;
      let best = node;
      for (let depth = 0; cur && depth < 8; depth += 1, cur = cur.parentElement) {
        const txt = clean(cur.textContent);
        const imgs = cur.querySelectorAll?.('img,picture,source,[style*="background-image"]').length || 0;
        const links = cur.querySelectorAll?.('a[href]').length || 0;
        const price = priceText(txt);
        const r = cur.getBoundingClientRect?.();
        if (r && r.width >= 100 && r.width <= 520 && r.height >= 90 && r.height <= 760 && (imgs || links) && (price || links || txt.length > 20)) best = cur;
        if (r && (r.width > 650 || r.height > 900)) break;
      }
      return best;
    };
    const scoreItem = (item) => {
      let score = 0;
      if (item.image) score += 35;
      if (item.price) score += 25;
      if (item.detailUrl && item.detailUrl !== sourceUrl) score += 25;
      if (detailLike(item.detailUrl)) score += 20;
      if (item.title && item.title.length >= 12) score += 20;
      if (/logo|banner|coupon|shipping|download app|sign in|categories/i.test(item.title)) score -= 80;
      return score;
    };
    const makeItem = (root, seedImg = '') => {
      const imageEl = root.querySelector?.('img,source,[style*="background-image"]') || root;
      const image = seedImg || imgUrl(imageEl) || [...root.querySelectorAll?.('img,source,[style*="background-image"]') || []].map(imgUrl).find(goodImage) || '';
      const imageAlt = clean(imageEl?.getAttribute?.('alt'));
      const detailUrl = bestLink(root) || sourceUrl;
      const title = textCandidates(root, imageAlt)[0] || (detailLike(detailUrl) ? decodeURIComponent(detailUrl.split('/').pop()?.replace(/[-_]+/g, ' ').replace(/g \d+.*/i, '') || '') : '');
      const price = priceNumber(root.textContent || '');
      const seller = clean(root.querySelector?.('[class*=store i],[class*=seller i],[class*=shop i]')?.textContent || '');
      return { title, name: title, image, price, sourcePrice: price, detailUrl, url: detailUrl, seller, _score: 0 };
    };

    const candidateRoots = new Set();

    // Marketplace-specific first pass: detail links and card-ish containers.
    const selectorSets = {
      temu: [
        'a[href*="-g-"]', 'a[href*="goods"]', '[data-testid*="product" i]', '[class*="goods" i]', '[class*="product" i]', '[class*="card" i]', '[class*="_2L_M"]'
      ],
      aliexpress: ['a[href*="/item/"]', 'a[href*="itemId="]', '[class*="product" i]', '[class*="item" i]', '[class*="card" i]'],
      shein: ['a[href*="-p-"]', '[class*="product" i]', '[class*="goods" i]', '[class*="S-product" i]'],
      generic: ['a[href*="goods"]','a[href*="item"]','a[href*="product"]','a[href*="/p/"]','[data-testid*="product" i]','[class*="product" i]','[class*="goods" i]','[class*="item" i]','[class*="card" i]','li','article']
    };
    const selectors = [...(selectorSets[marketplace] || []), ...selectorSets.generic];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node)) continue;
        candidateRoots.add(meaningfulAncestor(node));
      }
    }

    // Image-centered pass catches Temu cards whose useful data is not on the anchor itself.
    for (const node of document.querySelectorAll('img,source,[style*="background-image"]')) {
      const url = imgUrl(node);
      if (!goodImage(url) || !visible(node)) continue;
      const r = node.getBoundingClientRect?.();
      if (r && (r.width < 70 || r.height < 70)) continue;
      candidateRoots.add(meaningfulAncestor(node));
    }

    const raw = [];
    for (const root of candidateRoots) {
      const item = makeItem(root);
      item._score = scoreItem(item);
      if (item._score >= 45) raw.push(item);
    }

    const seen = new Set();
    const items = [];
    for (const item of raw.sort((a, b) => b._score - a._score)) {
      if (!item.title || item.title.length < 5) continue;
      if (!item.image && !item.price && (!item.detailUrl || item.detailUrl === sourceUrl)) continue;
      const key = `${(item.detailUrl || '').replace(/[?#].*/, '')}|${item.image}|${item.title.toLowerCase().slice(0,80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      delete item._score;
      items.push(item);
      if (items.length >= maxItems) break;
    }

    const bodyText = document.body?.innerText || '';
    return {
      title: document.title || '',
      htmlLength: document.documentElement.outerHTML.length,
      bodyTextLength: bodyText.length,
      imageCount: [...document.querySelectorAll('img,source,[style*="background-image"]')].map(imgUrl).filter(goodImage).length,
      linkCount: [...document.querySelectorAll('a[href]')].map((a) => abs(a.getAttribute('href'))).filter(detailLike).length,
      itemCount: items.length,
      items,
      blocked: /captcha|access denied|verify you are human|robot check|unusual traffic|security check/i.test(bodyText),
      extractor: marketplace === 'generic' ? 'generic-rendered-card-extractor' : `${marketplace}-rendered-card-extractor`,
    };
  }, { sourceUrl, maxItems, marketplace: marketplaceKey(sourceUrl) });

  console.log(JSON.stringify({
    ok: true,
    mode: 'rendered-feed',
    feedMode: true,
    rendered: true,
    marketplaceType: marketplaceType(sourceUrl),
    marketplaceKey: marketplaceKey(sourceUrl),
    sourceUrl,
    version: '012',
    ...result,
  }));
} catch (error) {
  console.error(JSON.stringify({ error: 'Headless render failed.', details: error?.message || String(error) }));
  process.exit(1);
} finally {
  if (browser) await browser.close().catch(() => {});
}
