import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #19: the Playwright smoke suite runs against a live deployment, which
 * neither `npm test` nor any CI runner can reach, so its acceptance criteria
 * would otherwise go unverified between QA runs. Pinned here as a contract on
 * the suite's own source: every step the issue names has to be present, the
 * suite has to stay read-only, and the run has to stay documented (env vars,
 * npm script, ssh tunnel, Node >= 20).
 *
 * This is deliberately not a re-implementation of the specs — it only fails when
 * a step disappears from e2e/smoke/, a write sneaks into it, or the docs drift.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMOKE_DIR = path.join(REPO_ROOT, 'e2e', 'smoke');

const smokeFiles = readdirSync(SMOKE_DIR)
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();
const smokeSource = smokeFiles
  .map((file) => readFileSync(path.join(SMOKE_DIR, file), 'utf8'))
  .join('\n');

// AC1 — "login, open my-library, open one detail page, open physical media,
// open the disc edit dialog and cancel".
const REQUIRED_STEPS: Array<[string, RegExp]> = [
  ['login through the shared helper', /\blogin\(page\)/],
  ['open my library', /goto\('\/dashboard\/my-library'\)/],
  ['open one detail page', /a\[href\^="\/dashboard\/my-library\/"\]/],
  ['open physical media', /goto\('\/dashboard\/physical-media'\)/],
  ['open the disc edit dialog', /'Edit Disc'/],
  ['cancel it', /getByRole\('button',\s*\{\s*name:\s*\/Cancel/i],
];

describe('e2e/smoke suite (issue #19 AC1)', () => {
  it('has spec files', () => {
    expect(smokeFiles.length).toBeGreaterThan(0);
  });

  for (const [step, pattern] of REQUIRED_STEPS) {
    it(`covers "${step}"`, () => {
      expect(pattern.test(smokeSource)).toBe(true);
    });
  }

  // AC1 says the suite is read-only; guard against a spec that starts writing.
  it('stays read-only — no direct API writes and no save/delete controls', () => {
    expect(/page\.request\.(post|put|patch|delete)/i.test(smokeSource)).toBe(false);
    const mutatingControls = /Save Changes|Create Disc|Save & add another|Remove from Library/i;
    expect(mutatingControls.test(smokeSource)).toBe(false);
  });

  it('fails loudly instead of skipping when the environment has no data', () => {
    expect(/test\.skip|test\.fixme|test\.only/.test(smokeSource)).toBe(false);
  });
});

describe('e2e/smoke run contract (issue #19 AC2-AC4)', () => {
  const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const testingGuide = readFileSync(path.join(REPO_ROOT, 'docs/guides/TESTING.md'), 'utf8');
  const playwrightConfig = readFileSync(path.join(REPO_ROOT, 'playwright.config.ts'), 'utf8');

  // AC2 — runs from BASE_URL / E2E_PASSWORD; AC3 — an npm script that exits non-zero.
  it('runs the smoke suite through npm run test:e2e:smoke', () => {
    expect(packageJson.scripts['test:e2e:smoke']).toBe('playwright test e2e/smoke');
  });

  it('points Playwright at BASE_URL instead of starting its own server', () => {
    expect(playwrightConfig).toContain('process.env.BASE_URL');
    // The config only mentions webServer in a comment explaining why it cannot
    // boot the Postgres/backend/frontend stack itself.
    expect(/webServer\s*:\s*\{/.test(playwrightConfig)).toBe(false);
  });

  it('documents the env vars, the ssh tunnel recipe and the Node >= 20 requirement', () => {
    for (const documented of [
      'BASE_URL',
      'E2E_PASSWORD',
      'npm run test:e2e:smoke',
      'ssh -N',
      'Node >= 20',
    ]) {
      // One needle per iteration; the test name carries the diagnostic.
      expect(testingGuide.includes(documented)).toBe(true);
    }
  });

  it('marks e2e/smoke as the read-only suite', () => {
    expect(testingGuide.includes('e2e/smoke/')).toBe(true);
    expect(testingGuide.includes('read-only')).toBe(true);
  });
});
