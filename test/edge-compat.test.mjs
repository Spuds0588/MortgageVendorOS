import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Edge-compatibility guard: the whole point of MortgageVendorOS is that it
// runs on Node 18+, Vercel Edge, and Cloudflare Workers — which means the
// shipped dist must never import Node builtins or use CommonJS. This test
// fails the build if a `node:` import sneaks in.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('dist exists and contains compiled JS', () => {
  const files = jsFiles(dist);
  assert.ok(files.length > 0, 'expected at least one compiled .js file in dist/');
});

test('no Node builtin imports (node:*) anywhere in dist', () => {
  const offenders = [];
  for (const file of jsFiles(dist)) {
    const src = readFileSync(file, 'utf8');
    const matches = src.match(/from\s+['"]node:[^'"]+['"]/g);
    if (matches) offenders.push({ file, matches });
  }
  assert.deepEqual(offenders, [], 'dist must not import Node builtins (node:*)');
});

test('no CommonJS require() or module.exports in dist (pure ESM)', () => {
  const offenders = [];
  for (const file of jsFiles(dist)) {
    const src = readFileSync(file, 'utf8');
    if (/\brequire\s*\(/.test(src) || /\bmodule\.exports\b/.test(src)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], 'dist must be pure ESM (no require/module.exports)');
});

test('dist uses only relative imports (self-contained, no runtime deps)', () => {
  const offenders = [];
  for (const file of jsFiles(dist)) {
    // Strip comments so doc-comment examples (e.g. `import x from 'pkg'`)
    // don't count as real imports.
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const externals = [...src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((spec) => !spec.startsWith('.'));
    if (externals.length) offenders.push({ file, externals });
  }
  assert.deepEqual(offenders, [], 'dist must only use relative imports');
});

test('package.json exports resolve and types point at dist', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.main.startsWith('./dist/'), 'main must point at dist');
  assert.ok(pkg.types.startsWith('./dist/'), 'types must point at dist');
  assert.equal(pkg.sideEffects, false, 'must be tree-shakeable');
  const imports = pkg.exports?.['.'];
  assert.ok(imports?.import?.startsWith('./dist/'), 'exports.import must point at dist');
  assert.ok(imports?.types?.startsWith('./dist/'), 'exports.types must point at dist');
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'must have zero runtime dependencies');
});

test('public entry point exports the full public API', async () => {
  const mod = await import('../dist/index.js');
  const expected = [
    'MortgageVendorOS',
    'SERVICE_TYPES',
    'BaseProvider',
    'MortgageVendorOSError',
    'MissingProviderError',
    'UnknownServiceError',
    'OrderNotFoundError',
    'ProviderError',
    'WebhookRequiredError',
    'RestEmailFallback',
    'MockProvider',
  ];
  for (const name of expected) {
    assert.ok(name in mod, `expected export "${name}" to exist`);
  }
});
