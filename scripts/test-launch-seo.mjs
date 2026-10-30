#!/usr/bin/env node
'use strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const site = 'https://learn-hanverse.netlify.app';
const indexable = ['explore.html'];
const noindex = ['learn.html', 'roadmap.html', 'practice.html', 'placement.html', 'lesson.html', 'talk.html'];
let failed = 0;
const test = (name, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failed++;
};
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sitemap = read('sitemap.xml');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const redirects = read('netlify.toml');

test('sitemap has a valid urlset root', /^<\?xml[^>]+>\s*<urlset\b/.test(sitemap));
test('sitemap lists only the intended public Explore page', locations.length === 1 && locations[0] === `${site}/explore.html`);
test('sitemap excludes the redirecting learning-app root', !locations.includes(`${site}/`));
test('sitemap excludes private or personalised pages', noindex.every(page => !locations.includes(`${site}/${page}`)));
test('sitemap excludes generic lesson shell', !locations.includes(`${site}/lesson.html`));
test('sitemap page has an absolute self canonical', read('explore.html').includes(`<link rel="canonical" href="${site}/explore.html">`));
test('sitemap does not contain an explicit redirect source', !locations.some(url => redirects.includes(`from = "${new URL(url).pathname}"`)));

const titles = new Set();
const descriptions = new Set();
for (const page of [...indexable, ...noindex]) {
  const html = read(page);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim();
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  test(`${page} has exactly one title`, Boolean(title) && (head.match(/<title>/gi)?.length || 0) === 1);
  test(`${page} has exactly one description`, Boolean(description) && (html.match(/<meta\s+name=["']description["']/gi)?.length || 0) === 1);
  test(`${page} title is unique in the reviewed set`, Boolean(title) && !titles.has(title));
  test(`${page} description is unique in the reviewed set`, Boolean(description) && !descriptions.has(description));
  titles.add(title); descriptions.add(description);
}
for (const page of noindex) test(`${page} is noindex`, /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(read(page)));

const faviconFiles = fs.readdirSync(root);
for (const page of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  const html = read(page);
  for (const match of html.matchAll(/<link\b[^>]*\brel=["']icon["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const ref = match[1];
    test(`${page} favicon exists with exact casing`, !ref.includes('..') && fs.existsSync(path.join(root, ref)) && faviconFiles.includes(ref));
  }
}
test('worksheets no longer uses the missing mascot favicon', !read('worksheets.html').includes('assets/mascot/hanpan.png'));
console.log(`\n${failed ? `❌ ${failed} launch SEO check(s) failed` : '✅ launch SEO checks passed'}`);
process.exit(failed ? 1 : 0);
