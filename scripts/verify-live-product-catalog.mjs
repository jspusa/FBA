import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { validateFbaSnapshot } = require('../product-catalog.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultPageUrl = 'https://jspusa.github.io/FBA/inbound-plan.html';

export function parseLiveCatalog(html) {
  const match = String(html || '').match(/const BUILTIN_CATALOG_SNAPSHOT=(\{.*?\});\s*const BUILTIN_CATALOG_ADAPTER=/s);
  if (!match) throw new Error('Live inbound-plan.html does not contain the generated product catalog');
  return validateFbaSnapshot(JSON.parse(match[1]));
}

export function verifyLiveCatalog({ html, expectedSnapshot, expectedVersion }) {
  const live = parseLiveCatalog(html);
  const expected = validateFbaSnapshot(expectedSnapshot);
  if (live.catalogVersion !== expectedVersion) {
    throw new Error(`Live FBA catalog is ${live.catalogVersion}; expected ${expectedVersion}`);
  }
  if (JSON.stringify(live) !== JSON.stringify(expected)) {
    throw new Error('Live FBA catalog content differs from the checked-in snapshot');
  }
  return live;
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchText(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}verify=${Date.now()}`, {
    headers:{ 'cache-control':'no-cache' },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const pageUrl = option('--url', defaultPageUrl);
  const expectedSnapshot = JSON.parse(fs.readFileSync(path.join(repoRoot, 'catalog', 'fba-product-catalog.snapshot.json'), 'utf8'));
  const expectedVersion = option('--version', expectedSnapshot.catalogVersion);
  const attempts = Number(option('--attempts', '20'));
  const delayMs = Number(option('--delay-ms', '5000'));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const html = await fetchText(pageUrl);
      const live = verifyLiveCatalog({ html, expectedSnapshot, expectedVersion });
      const liveShared = await fetchText(new URL('shared-product-catalog.js', pageUrl).href);
      const localShared = fs.readFileSync(path.join(repoRoot, 'shared-product-catalog.js'), 'utf8');
      if (liveShared !== localShared) throw new Error('Live shared-product-catalog.js differs from the checked-in file');
      console.log(`Verified live FBA product catalog ${live.catalogVersion} (${live.products.length} entries) on attempt ${attempt}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(delayMs);
    }
  }
  throw lastError;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
