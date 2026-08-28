import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = path.join(repoRoot, 'workspace-shell.css');
const HEADER = /^\/\*!\n \* FBA Visual System\n \* version: (?<version>\d+\.\d+\.\d+)\n \* mode: (?<mode>[a-z-]+)\n \* content-sha256: (?<hash>[a-f0-9]{64}|__CONTENT_SHA256__)\n \* source: jspusa\/FBA workspace-shell\.css\n \*\/\n/;

export function inspectVisualSystem(source) {
  const match = source.match(HEADER);
  if (!match?.groups) throw new Error('FBA Visual System metadata header is missing or invalid');
  if (match.groups.mode !== 'normal-light') throw new Error(`Unsupported FBA Visual System mode: ${match.groups.mode}`);
  const body = source.slice(match[0].length);
  const contentHash = createHash('sha256').update(body).digest('hex');
  return Object.freeze({
    version:match.groups.version,
    mode:match.groups.mode,
    declaredHash:match.groups.hash,
    contentHash,
    body,
  });
}

export function verifyVisualSystem(source) {
  const inspected = inspectVisualSystem(source);
  if (inspected.declaredHash !== inspected.contentHash) {
    throw new Error(`FBA Visual System content hash drift: declared ${inspected.declaredHash}, actual ${inspected.contentHash}`);
  }
  return inspected;
}

export function stampVisualSystem(source) {
  const inspected = inspectVisualSystem(source);
  return source.replace(`content-sha256: ${inspected.declaredHash}`, `content-sha256: ${inspected.contentHash}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = fs.readFileSync(artifactPath, 'utf8');
  if (process.argv.includes('--write')) {
    fs.writeFileSync(artifactPath, stampVisualSystem(source));
    const inspected = verifyVisualSystem(fs.readFileSync(artifactPath, 'utf8'));
    console.log(`Stamped FBA Visual System v${inspected.version} (${inspected.contentHash})`);
  } else {
    const inspected = verifyVisualSystem(source);
    console.log(`Verified FBA Visual System v${inspected.version} (${inspected.contentHash})`);
  }
}
