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

// Static files first (only existing files match)
app.use(express.static(__dirname, { extensions: ['html'] }));

// Clean URLs matching netlify.toml redirects
const CLEAN_PAGES = [
  'parents', 'learn', 'profile', 'admin', 'worksheets', 'verify-email',
];
for (const page of CLEAN_PAGES) {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, `${page}.html`)));
}

// API routes: only these prefixes go to the Netlify function's Express app,
// so its own 404 handler never shadows the static site.
const API_PREFIX = /^\/(api|\.netlify\/functions\/server)(\/|$)/;
app.use((req, res, next) => (API_PREFIX.test(req.path) ? apiApp(req, res, next) : next()));

// Fallback to index.html (mirrors netlify.toml 404 -> index.html)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Hanverse local server running at http://${HOST}:${PORT}`);
});
