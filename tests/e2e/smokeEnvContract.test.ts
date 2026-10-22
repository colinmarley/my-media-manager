import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Issue #19 AC2/AC3 from the other side: the Playwright suite needs a live
// BASE_URL, so the run itself cannot be a CI gate. These tests pin the plumbing
// that makes the run possible at all — target and credentials come from the
// environment, nothing in the suite hard-codes a host, the suite stays read-only
// at the network level, and one npm script runs exactly the read-only suite.

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SMOKE_DIR = path.join(REPO_ROOT, 'e2e', 'smoke');
const SUPPORT_DIR = path.join(REPO_ROOT, 'e2e', 'support');

const specFiles = readdirSync(SMOKE_DIR)
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();

const specSource = specFiles
  .map((file) => readFileSync(path.join(SMOKE_DIR, file), 'utf8'))
  .join('\n');

const supportSource = readdirSync(SUPPORT_DIR)
  .map((file) => readFileSync(path.join(SUPPORT_DIR, file), 'utf8'))
  .join('\n');

const suiteSource = `${specSource}\n${supportSource}`;

const playwrightConfig = readFileSync(path.join(REPO_ROOT, 'playwright.config.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

describe('smoke suite environment contract (issue #19 AC2)', () => {
  it('takes the deployment under test from BASE_URL', () => {
    expect(playwrightConfig).toMatch(/baseURL:\s*process\.env\.BASE_URL/);
  });

  it('takes the passphrase from E2E_PASSWORD', () => {
    expect(supportSource).toMatch(/process\.env\.E2E_PASSWORD/);
  });

  it('navigates relative to BASE_URL instead of hard-coding a host', () => {
    const gotoCalls = suiteSource.match(/page\.goto\([^)]*\)/g) ?? [];
    expect(gotoCalls.length).toBeGreaterThan(0);
    for (const call of gotoCalls) {
      expect(call).toMatch(/page\.goto\('\/(login|dashboard|admin)/);
    }
    expect(suiteSource).not.toMatch(/goto\(['"`]https?:\/\//);
  });
});

describe('smoke suite read-only guard (issue #19 AC1)', () => {
  it('records writes made by the page and fails on any of them', () => {
    expect(specSource).toMatch(/page\.on\(\s*['"]request['"]\s*,/);
    expect(specSource).toMatch(/POST/);
    expect(specSource).toMatch(/PUT/);
    expect(specSource).toMatch(/PATCH/);
    expect(specSource).toMatch(/DELETE/);
    // The collected request list is asserted empty, message included.
    expect(specSource).toMatch(/^[ \t]*expect\([a-z_]+\b.*\)\.toEqual\(\[\]\)/m);
  });

  it('never submits a form or signs out on the way through', () => {
    expect(suiteSource).not.toMatch(/\.submit\(/);
    expect(suiteSource).not.toMatch(/logout|signout|sign-out/i);
  });
});

describe('smoke run script (issue #19 AC3)', () => {
  it('is one npm script that runs the read-only suite and nothing else', () => {
    const script = packageJson.scripts['test:e2e:smoke'];
    expect(script).toBeDefined();
    expect(script).toMatch(/^playwright test e2e\/smoke\b/);
    expect(script).not.toContain('e2e/write');
  });

  it('does not swallow the exit code', () => {
    const script = packageJson.scripts['test:e2e:smoke'];
    expect(script).not.toMatch(/\|\|\s*true|;\s*true|exit\s+0/);
  });

  it('cannot pass by running nothing', () => {
    expect(playwrightConfig).toMatch(/testDir:\s*'\.\/e2e'/);
    expect(playwrightConfig).not.toMatch(/testIgnore/);
    expect(specFiles.length).toBeGreaterThanOrEqual(2);
  });
});
