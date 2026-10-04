#!/usr/bin/env node
/* Static checks on the userscript that a type checker cannot do:
 *  - every GM_* API used is declared with @grant
 *  - every external host contacted is declared with @connect
 *  - the header @version matches the newest CHANGELOG entry and the
 *    version shown in the settings dialog */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'src', 'subsplease-fine-enhancer.user.js');
const CHANGELOG = path.join(REPO, 'CHANGELOG.md');

const src = fs.readFileSync(SCRIPT, 'utf8');
const header = src.slice(src.indexOf('// ==UserScript=='), src.indexOf('// ==/UserScript=='));
const problems = [];

const directives = (name) => [...header.matchAll(new RegExp(`^// @${name}\\s+(.+)$`, 'gm'))].map((m) => m[1].trim());
const grants = new Set(directives('grant'));
const connects = new Set(directives('connect'));
const body = src.slice(src.indexOf('// ==/UserScript=='));

// 1. GM_* usage vs @grant
const used = new Set([...body.matchAll(/\bGM_[A-Za-z]+/g)].map((m) => m[0]));
for (const api of [...used].sort()) {
  if (!grants.has(api)) problems.push(`GM API "${api}" is used but not declared with // @grant ${api}`);
}
for (const granted of [...grants].sort()) {
  if (!used.has(granted)) problems.push(`// @grant ${granted} is declared but never used`);
}

// 2. Hosts fetched via GM_xmlhttpRequest vs @connect.
// Only GM_xmlhttpRequest is governed by @connect — plain <a href> and
// GM_openInTab targets (e.g. anidb.net) do not need a declaration.
const xhrHosts = new Set();
for (const m of body.matchAll(/GM_xmlhttpRequest\s*\(/g)) {
  const window_ = body.slice(m.index, m.index + 900);
  for (const h of window_.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) xhrHosts.add(h[1].toLowerCase());
}
for (const host of [...xhrHosts].sort()) {
  const covered = [...connects].some((c) => host === c || host.endsWith('.' + c));
  if (!covered) problems.push(`host "${host}" is fetched via GM_xmlhttpRequest but not declared with // @connect ${host}`);
}

// 3. The README's dev-wrapper snippets must carry the same grants/connects:
// Tampermonkey reads them from the wrapper, not from the @require'd file, so
// drift here breaks local development with a confusing runtime error.
const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
for (const block of readme.match(/```js\n\/\/ ==UserScript==[\s\S]*?```/g) || []) {
  const label = /localhost:8080/.test(block) ? 'Firefox' : 'Chrome';
  const blockGrants = new Set([...block.matchAll(/^\/\/ @grant\s+(.+)$/gm)].map((m) => m[1].trim()));
  const blockConnects = new Set([...block.matchAll(/^\/\/ @connect\s+(.+)$/gm)].map((m) => m[1].trim()));
  for (const g of [...grants].sort()) {
    if (!blockGrants.has(g)) problems.push(`README ${label} dev wrapper is missing // @grant ${g}`);
  }
  for (const c of [...connects].sort()) {
    if (!blockConnects.has(c)) problems.push(`README ${label} dev wrapper is missing // @connect ${c}`);
  }
  for (const g of [...blockGrants].sort()) {
    if (!grants.has(g)) problems.push(`README ${label} dev wrapper grants ${g}, which the script no longer declares`);
  }
}

// 4. Versions agree
const headerVersion = (header.match(/^\/\/ @version\s+(\S+)$/m) || [])[1];
const changelogVersion = (fs.readFileSync(CHANGELOG, 'utf8').match(/^## \[([^\]]+)\]/m) || [])[1];
const dialogVersion = (src.match(/sp-version">v([0-9][^<]*)</) || [])[1];
if (!headerVersion) problems.push('no @version in the userscript header');
if (headerVersion && changelogVersion && headerVersion !== changelogVersion) {
  problems.push(`@version ${headerVersion} does not match the newest CHANGELOG entry [${changelogVersion}]`);
}
if (headerVersion && dialogVersion && headerVersion !== dialogVersion) {
  problems.push(`@version ${headerVersion} does not match the version shown in the settings dialog (v${dialogVersion})`);
}

if (problems.length) {
  console.error('metadata check FAILED:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(`metadata check passed (${grants.size} grants, ${connects.size} connects, version ${headerVersion})`);
