import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #19 — the single Vitest contract over the Playwright smoke run.
 *
 * The suite drives a live deployment, which neither `npm test` nor CI can reach,
 * so its acceptance criteria would otherwise go unverified between QA runs.
 * Pinned here from the suite's own source plus its docs: every step the issue
 * names is present, the suite stays read-only, target and credentials come from
 * the environment, one npm script runs exactly that suite and exits non-zero,
 * and the run stays documented (env vars, ssh tunnel, Node 20).
 *
 * Deliberately not a re-implementation of the specs, and it pins behaviour
 * rather than wording: doc prose is matched loosely, so rewording TESTING.md or
 * adding a helper under e2e/support/ does not break this gate.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMOKE_DIR = path.join(REPO_ROOT, 'e2e', 'smoke');
const SUPPORT_DIR = path.join(REPO_ROOT, 'e2e', 'support');

const smokeFiles = readdirSync(SMOKE_DIR)
  .filter((file) => file.endsWith('.spec.ts'))
  .sort();
const smokeSource = smokeFiles
  .map((file) => readFileSync(path.join(SMOKE_DIR, file), 'utf8'))
  .join('\n');
const supportSource = readdirSync(SUPPORT_DIR)
  .map((file) => readFileSync(path.join(SUPPORT_DIR, file), 'utf8'))
  .join('\n');
const suiteSource = `${smokeSource}\n${supportSource}`;

const playwrightConfig = readFileSync(path.join(REPO_ROOT, 'playwright.config.ts'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const testingGuide = readFileSync(path.join(REPO_ROOT, 'docs/guides/TESTING.md'), 'utf8');

// AC1 — "login, open my-library, open one detail page, open physical media,
// open the disc edit dialog and cancel".
const REQUIRED_STEPS: Array<[string, RegExp]> = [
  ['login through the shared helper', /\blogin\(page\)/],
  ['open my library', /goto\(\s*['"]\/dashboard\/my-library['"]/],
  ['open one detail page', /a\[href\^="\/dashboard\/my-library\/"\]/],
  ['open physical media', /goto\(\s*['"]\/dashboard\/physical-media['"]/],
  ['open the disc edit dialog', /['"]Edit Disc['"]/],
  ['cancel it', /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:\s*\/[Cc]ancel/],
];

describe('e2e/smoke walkthrough (issue #19 AC1)', () => {
  it('has spec files to run', () => {
    // Two or more: the pre-existing read-only specs plus the issue #19 one.
    expect(smokeFiles.length).toBeGreaterThanOrEqual(2);
  });

  for (const [step, pattern] of REQUIRED_STEPS) {
    it(`covers "${step}"`, () => {
      expect(pattern.test(smokeSource)).toBe(true);
    });
  }

  it('reads a card title from the card body, not from any heading in the card link', () => {
    // my-library/page.tsx swaps in a poster fallback whose Typography is
    // variant="subtitle1", and MUI maps subtitle1 to an <h6>. It sits above the
    // real title and holds the folder name, so an unscoped
    // getByRole('heading', { level: 6 }) inside the card link is a strict-mode
    // violation on every card whose poster request 404s — and reads the wrong
    // text if .first() is used instead.
    expect(smokeSource).toMatch(
      /MuiCardContent-root[\s\S]{0,160}getByRole\(\s*['"]heading['"]\s*,\s*\{\s*level:\s*6/,
    );
  });

  it('fails loudly instead of skipping when the environment has no data', () => {
    expect(/test\.(skip|fixme|only|conditionalSkip)/.test(smokeSource)).toBe(false);
  });
});

describe('e2e/smoke stays read-only (issue #19 AC1)', () => {
  it('records the requests the page makes and fails on any write', () => {
    expect(smokeSource).toMatch(/page\.on\(\s*['"]request['"]\s*,/);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(smokeSource).toContain(method);
    }
    // The collected list has to be asserted empty, message included.
    expect(smokeSource).toMatch(/^[ \t]*expect\([a-z_]+\b.*\)\.toEqual\(\[\]\)/m);
  });

  it('uses no API write helper, no form submit and no mutating control', () => {
    expect(/page\.request\.(post|put|patch|delete)/i.test(suiteSource)).toBe(false);
    expect(suiteSource).not.toMatch(/\.submit\(/);
    const mutatingControls = /Save Changes|Create Disc|Save & add another|Remove from Library/i;
    expect(mutatingControls.test(smokeSource)).toBe(false);
  });
});

describe('smoke run environment (issue #19 AC2)', () => {
  it('takes the deployment under test from BASE_URL', () => {
    expect(playwrightConfig).toMatch(/baseURL:\s*process\.env\.BASE_URL/);
    // The config only mentions webServer in a comment explaining why it cannot
    // boot the Postgres/backend/frontend stack itself.
    expect(/webServer\s*:\s*\{/.test(playwrightConfig)).toBe(false);
  });

  it('takes the passphrase from E2E_PASSWORD', () => {
    expect(supportSource).toMatch(/process\.env\.E2E_PASSWORD/);
  });

  it('navigates relative to BASE_URL instead of hard-coding a host', () => {
    expect(suiteSource).not.toMatch(/goto\(\s*['"`]https?:\/\//);
  });
});

describe('smoke run script (issue #19 AC3)', () => {
  const script: string | undefined = packageJson.scripts['test:e2e:smoke'];

  it('runs the smoke suite through npm run test:e2e:smoke', () => {
    expect(script).toBeTypeOf('string');
    expect(script).toMatch(/playwright\s+test\b/);
    expect(script).toContain('e2e/smoke');
  });

  it('runs the read-only suite only — never e2e/write', () => {
    expect(script).not.toContain('e2e/write');
  });

  it('does not swallow the exit code', () => {
    expect(script).not.toMatch(/\|\|\s*true|;\s*true|\bexit\s+0\b/);
  });

  it('cannot pass by running nothing', () => {
    expect(playwrightConfig).toMatch(/testDir:\s*['"]\.\/e2e['"]/);
    expect(playwrightConfig).not.toMatch(/testIgnore/);
  });
});

describe('smoke run docs (issue #19 AC2 and AC4)', () => {
  const guide = testingGuide.toLowerCase();

  it('names the smoke suite and how to run it', () => {
    expect(testingGuide).toContain('e2e/smoke/');
    expect(guide).toContain('npm run test:e2e:smoke');
  });

  it('documents both env vars', () => {
    expect(testingGuide).toContain('BASE_URL');
    expect(testingGuide).toContain('E2E_PASSWORD');
  });

  it('documents an ssh tunnel recipe for reaching the app host', () => {
    expect(guide).toContain('tunnel');
    // A local forward, not just the word "ssh": ssh [-options] -L <local>:<host>:<remote>
    expect(guide).toMatch(/ssh[^\n]{0,120}\s-l\s+\S+:\d+:\S+:\d+/);
  });

  it('documents the node 20 requirement for the suite', () => {
    expect(guide).toMatch(/node[^\n]{0,60}\b20\b/);
  });
});
