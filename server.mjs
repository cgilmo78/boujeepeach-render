#!/usr/bin/env node
import express from 'express';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'boujee-peach-render-service', version: '009' });
});

app.post('/render-feed', (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim();
  const maxItems = Math.max(1, Math.min(60, Number(req.body?.maxItems || 36)));
  if (!/^https?:\/\//i.test(sourceUrl)) return res.status(422).json({ error: 'A valid sourceUrl is required.' });
  const child = spawn(process.execPath, [path.join(__dirname, 'feed-renderer.mjs'), sourceUrl, String(maxItems)], {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, Number(process.env.RENDER_TIMEOUT_MS || 90000));
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('close', (code) => {
    clearTimeout(timer);
    const raw = (stdout || stderr || '').trim();
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    if (code !== 0 || !data) {
      return res.status(503).json({ error: data?.error || 'Headless render failed.', details: data?.details || raw.slice(0, 900) });
    }
    res.json(data);
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Boujee Peach render service listening on ${PORT}`);
});
