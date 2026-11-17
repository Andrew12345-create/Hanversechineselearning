/**
 * Local dev server for Hanverse.
 *
 * Serves the static site and mounts the same Express app that runs on Netlify
 * (functions/server.js), so /.netlify/functions/server/* and /api/* work locally.
 * Also applies the clean-URL rewrites from netlify.toml (e.g. /learn -> /learn.html).
 */
import express from 'express';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app as apiApp } from './functions/server.js';

if (existsSync('.env')) dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || 'localhost';
const PORT = Number(process.env.PORT || 3000);

const app = express();

// The learning subdomain deliberately sends its root and index URL to the
// separate marketing site. Keep local development aligned with that behavior.
app.get(['/', '/index.html'], (_req, res) => {
  res.redirect(302, 'https://hanverse.netlify.app/');
});

// Static files first (only existing files match)
app.use(express.static(__dirname, { extensions: ['html'] }));

// Clean URLs matching netlify.toml redirects
const CLEAN_PAGES = [
  'parents', 'learn', 'profile', 'admin', 'verify-email',
];
for (const page of CLEAN_PAGES) {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, `${page}.html`)));
}

// API routes: only these prefixes go to the Netlify function's Express app,
// so its own 404 handler never shadows the static site.
const API_PREFIX = /^\/(api|\.netlify\/functions\/server)(\/|$)/;
app.use((req, res, next) => (API_PREFIX.test(req.path) ? apiApp(req, res, next) : next()));

// Standalone Netlify functions (CommonJS handlers) — mounted locally so the
// payment flow (.netlify/functions/check-premium, create-checkout-session,
// auth-signup, savelevel, stripe-webhook) works in dev exactly like prod.
import { createRequire } from 'module';
const requireCjs = createRequire(import.meta.url);

const LAMBDA_FNS = ['auth-signup', 'check-premium', 'create-checkout-session', 'savelevel', 'stripe-webhook'];

function toLambdaEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers,
    rawHeaders: undefined,
    queryStringParameters: Object.fromEntries(
      Object.entries(req.query || {}).map(([k, v]) => [k, String(v)])
    ),
    rawQueryString: req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '',
    body: req.body !== undefined ? JSON.stringify(req.body) : null,
    isBase64Encoded: false
  };
}

for (const name of LAMBDA_FNS) {
  app.post(`/.netlify/functions/${name}`, express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const handler = requireCjs(`./functions/${name}.cjs`);
      const fn = handler.handler || handler.default || handler;
      const event = toLambdaEvent(req);
      const result = await fn(event, {});
      const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      res.set(result.headers || {});
      return res.status(result.statusCode || 200).send(body);
    } catch (e) {
      console.error(`Local function ${name} failed:`, e);
      return res.status(500).json({ success: false, error: 'Function error' });
    }
  });
}

// Keep unknown URLs on a real 404 page; the learning app has no index.html.
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Hanverse local server running at http://${HOST}:${PORT}`);
});
