#!/usr/bin/env node
/* Test runner.
 *   node test/run.js            run every spec
 *   node test/run.js shows sync run only the named specs
 *   VERBOSE=1 node test/run.js  also print passing checks
 */
const fs = require('fs');
const path = require('path');
const { startServer, newDevice } = require('./lib/env');

const SPEC_DIR = path.join(__dirname, 'specs');
const filters = process.argv.slice(2);
const VERBOSE = process.env.VERBOSE === '1';

const specs = fs.readdirSync(SPEC_DIR)
  .filter((f) => f.endsWith('.spec.js'))
  .filter((f) => !filters.length || filters.some((n) => f.includes(n)))
  .sort();

if (!specs.length) {
  console.error(filters.length ? `No specs match: ${filters.join(', ')}` : 'No specs found.');
  process.exit(1);
}

const results = [];
function makeCheck(specName) {
  return (name, condition, detail = '') => {
    const ok = !!condition;
    results.push({ spec: specName, name, ok, detail });
    if (!ok) console.log(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`);
    else if (VERBOSE) console.log(`  ✓ ${name}`);
  };
}

(async () => {
  const started = Date.now();
  let browser = null;
  let server = null;

  // Browser-backed specs declare `browser: true`; pure unit specs don't need one.
  const loaded = specs.map((file) => ({ file, mod: require(path.join(SPEC_DIR, file)) }));
  const needsBrowser = loaded.some(({ mod }) => mod.browser !== false);

  try {
    if (needsBrowser) {
      let chromium;
      try {
        ({ chromium } = require('playwright'));
      } catch {
        console.error('playwright is not installed — run `make bootstrap` first.');
        process.exit(1);
      }
      const launch = {};
      if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
      else if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
      try {
        browser = await chromium.launch(launch);
      } catch (err) {
        console.error(`Could not launch Chromium: ${err.message}\nRun \`make bootstrap\` (or \`make doctor\`) to install it.`);
        process.exit(1);
      }
      server = await startServer();
    }

    for (const { file, mod } of loaded) {
      const name = mod.name || file.replace('.spec.js', '');
      console.log(`\n▸ ${name}`);
      const check = makeCheck(name);
      const before = results.length;
      try {
        await mod.run({
          check,
          base: server && server.base,
          state: server && server.state,
          browser,
          newDevice: (opts) => newDevice(browser, server.base, opts),
        });
      } catch (err) {
        check(`${name} threw`, false, err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : String(err));
      }
      const specResults = results.slice(before);
      const failed = specResults.filter((r) => !r.ok).length;
      console.log(`  ${specResults.length - failed}/${specResults.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }

  const failed = results.filter((r) => !r.ok);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${'─'.repeat(52)}`);
  if (failed.length) {
    console.log(`FAILED: ${failed.length} of ${results.length} checks (${secs}s)\n`);
    failed.forEach((f) => console.log(`  ✗ [${f.spec}] ${f.name}${f.detail ? `  — ${f.detail}` : ''}`));
    process.exit(1);
  }
  console.log(`All ${results.length} checks passed (${secs}s)`);
})();
