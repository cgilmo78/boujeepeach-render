import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;

const NEGATIVE_TEXT = [
  'download',
  'google play',
  'app store',
  'privacy',
  'coupon',
  'track order',
  'price alert',
  'secure checkout',
  'install',
  'open app',
  'sign in',
  'log in',
  'cookie',
  'terms',
  'wishlist',
  'shipping info'
];

function cleanText(str = '') {
  return str
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

function extractPrice(text = '') {
  const match = text.match(
    /(\$|US\$|USD|€|£)\s?\d+(?:\.\d{1,2})?/i
  );

  return match ? match[0] : '';
}

app.get('/health/render', async (req, res) => {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true
    });

    await browser.close();

    res.json({
      ok: true,
      service: 'boujee-peach-render-service',
      browser: 'chromium',
      version: '013'
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Chromium health check failed.',
      details: err.message
    });
  }
});

app.post('/render-feed', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      ok: false,
      error: 'Missing URL'
    });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 2200
      }
    });

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 120000
    });

    // allow hydration
    await page.waitForTimeout(5000);

    // auto scroll for lazy loading
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let total = 0;
        const distance = 1000;

        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          total += distance;

          if (total > 12000) {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      });
    });

    await page.waitForTimeout(3000);

    const products = await page.evaluate((NEGATIVE_TEXT) => {

      function clean(str = '') {
        return str
          .replace(/\s+/g, ' ')
          .replace(/\n/g, ' ')
          .trim();
      }

      function getPrice(text = '') {
        const match = text.match(
          /(\$|US\$|USD|€|£)\s?\d+(?:\.\d{1,2})?/i
        );

        return match ? match[0] : '';
      }

      function visible(el) {
        const style = window.getComputedStyle(el);

        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0'
        ) {
          return false;
        }

        return true;
      }

      const anchors = [
        ...document.querySelectorAll('a[href]')
      ].filter(a => {
        const href = a.href || '';

        return (
          href.includes('-g-') ||
          href.includes('goods') ||
          href.includes('goods_id')
        );
      });

      const results = [];
      const seen = new Set();

      anchors.forEach(anchor => {

        const href = anchor.href;

        if (!href || seen.has(href)) {
          return;
        }

        const card =
          anchor.closest('[data-testid]') ||
          anchor.closest('[class*="product"]') ||
          anchor.closest('[class*="goods"]') ||
          anchor.closest('div');

        if (!card) {
          return;
        }

        if (!visible(card)) {
          return;
        }

        const style = window.getComputedStyle(card);

        if (
          style.position === 'fixed' ||
          style.position === 'sticky'
        ) {
          return;
        }

        const text = clean(card.innerText || '');

        if (!text || text.length < 10) {
          return;
        }

        const lower = text.toLowerCase();

        if (
          NEGATIVE_TEXT.some(term =>
            lower.includes(term)
          )
        ) {
          return;
        }

        const img =
          card.querySelector('img');

        if (!img) {
          return;
        }

        const width =
          img.naturalWidth ||
          img.width ||
          0;

        const height =
          img.naturalHeight ||
          img.height ||
          0;

        if (
          width < 120 ||
          height < 120
        ) {
          return;
        }

        const image =
          img.src ||
          img.getAttribute('src') ||
          img.getAttribute('data-src') ||
          '';

        if (!image) {
          return;
        }

        const price = getPrice(text);

        const title =
          clean(
            img.alt ||
            anchor.getAttribute('title') ||
            text.split('$')[0] ||
            text
          ).slice(0, 220);

        let score = 0;

        if (href.includes('-g-')) {
          score += 40;
        }

        if (
          href.includes('goods')
        ) {
          score += 25;
        }

        if (price) {
          score += 20;
        }

        if (
          title &&
          title.length > 20
        ) {
          score += 15;
        }

        if (width > 200) {
          score += 10;
        }

        if (
          text.length > 50
        ) {
          score += 5;
        }

        if (score < 40) {
          return;
        }

        seen.add(href);

        results.push({
          title,
          price,
          image,
          url: href,
          confidence: score
        });
      });

      results.sort((a, b) => {
        return b.confidence - a.confidence;
      });

      return results.slice(0, 100);

    }, NEGATIVE_TEXT);

    await browser.close();

    res.json({
      ok: true,
      count: products.length,
      products
    });

  } catch (err) {

    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      ok: false,
      error: 'Headless render failed.',
      details: err.message
    });
  }
});

app.get('/', (req, res) => {
  res.send('Boujee Peach Renderer Online');
});

app.listen(PORT, () => {
  console.log(
    `Boujee Peach renderer running on ${PORT}`
  );
});
