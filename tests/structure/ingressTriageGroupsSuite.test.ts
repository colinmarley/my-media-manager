/**
 * The acceptance-criteria map for the grouped triage view (issue #35), kept as an executable
 * artifact rather than PR prose — the same way backend/tests/test_ingress_triage_acceptance_issue34.py
 * resolved the equivalent criterion on #34.
 *
 * AC7 of #35 reads "npx vitest run passes, with new component tests that fail on refactor", which
 * is a statement about the suite itself and resolves to no single component, so it is pinned here:
 * the #35 suites exist, the project's vitest run collects them (and the verify command's two
 * excluded paths are not among them), every criterion maps onto a test title that really exists,
 * none of those tests is focused or skipped, and the new suites import modules only this change
 * adds — the component, its row components, the group model, and the `getQueueGroups` /
 * `bulkQueueAction` service methods — which is why they cannot load on `refactor`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

const COMPONENT_SUITE = 'tests/components/IngressTriageGroups.test.tsx';
const QA_PROBE_SUITE = 'tests/components/IngressTriageGroupsQaProbes.test.tsx';
const MODEL_SUITE = 'tests/utils/ingressTriageGroupsModel.test.ts';
const MAP_SUITE = 'tests/structure/ingressTriageGroupsSuite.test.ts';

const TRIAGE_SUITES = [COMPONENT_SUITE, QA_PROBE_SUITE, MODEL_SUITE, MAP_SUITE];

// Sources #35 adds. On `refactor` none of them exist, so the suites above fail at import time there.
const TRIAGE_MODULES = [
  'src/app/admin/_components/IngressTriageGroups.tsx',
  'src/app/admin/_components/ingress/IngressTriageRows.tsx',
  'src/service/ingress/ingressTriageGroupsModel.ts',
];

// The paths the factory's `npx vitest run` invocation excludes; #35's tests must not hide there.
const VERIFY_EXCLUSIONS = [
  'tests/components/MediaAssignment.test.ts',
  'tests/utils/useAuthenticationStore.test.ts',
];

/** criterion -> the tests that pin it, by name, so the map cannot rot into a stale comment. */
const CRITERION_MAP: Record<string, Array<[string, string]>> = {
  // One row per group from GET /queue/groups, paged and filtered server-side.
  AC1: [
    [COMPONENT_SUITE, 'AC1: renders one row per folder with counts and per-status chips'],
    [COMPONENT_SUITE, 'AC1: pages groups server-side through the table pagination control'],
  ],
  // Selecting a group and Accept/Ignore issues one bulk request; the row follows the response.
  AC2: [
    [COMPONENT_SUITE, 'AC2: accepts a small group with a single group-scoped bulk request'],
    [COMPONENT_SUITE, 'AC2: rekeys the group row from the batch response instead of refetching the page'],
    [COMPONENT_SUITE, 'AC2: excludes preview rows from a selected group before posting the batch'],
    [COMPONENT_SUITE, 'AC2: marks the group in flight and puts the counts back when the batch request fails'],
    [COMPONENT_SUITE, 'AC2: confirms before accepting a group that spans more than the threshold'],
    [COMPONENT_SUITE, 'AC2: requires an explicit confirmation for ignore, which only the history log can undo'],
    [MODEL_SUITE, 'sends the group selector rather than the group ids, so one request covers the folder'],
    [MODEL_SUITE, 'rekeys a group row from the batch response, including rows the cap left undetailed'],
  ],
  // A group accept runs the same server path as a single-item accept.
  AC3: [
    [COMPONENT_SUITE, 'AC3: acts on a single preview row through the same bulk endpoint as the group'],
    [COMPONENT_SUITE, 'AC2: accepts a small group with a single group-scoped bulk request'],
  ],
  // Expanding a 1,000+ item group keeps the rendered row count bounded.
  AC4: [
    [COMPONENT_SUITE, 'AC4: keeps rendered rows bounded when a page holds many groups'],
    [COMPONENT_SUITE, 'AC4: keeps rendered rows under a fixed bound for a 200-group page with expanded previews'],
    [COMPONENT_SUITE, 'AC4: counts the rest of the folder instead of rendering it when a preview is expanded'],
    [QA_PROBE_SUITE, 'AC4: keeps rendered rows bounded when a 1,930-item group is expanded with an oversized preview'],
    [MODEL_SUITE, 'flattens expanded previews into rows and bounds the rendered window'],
  ],
  // Batch failures are reported per item; a partial batch leaves its successes marked.
  AC5: [
    [COMPONENT_SUITE, 'AC5: reports failed rows returned by the batch'],
    [QA_PROBE_SUITE, 'AC5: keeps accepted rows marked when the batch also reports per-item failures'],
    [MODEL_SUITE, 'summarizes batch results including truncation at the server cap'],
  ],
  // The existing status filter and search box drive the server query.
  AC6: [
    [COMPONENT_SUITE, 'AC6: sends search and status filters to the API instead of filtering rows locally'],
    [QA_PROBE_SUITE, 'AC6: sends the status filter to the API instead of filtering group rows locally'],
  ],
  // This suite: the run passes, and the tests it adds are this change's own.
  AC7: [
    [MAP_SUITE, 'AC7: ships grouped-triage test files that the vitest run collects'],
    [MAP_SUITE, 'AC7: maps every #35 criterion onto a test that exists'],
    [MAP_SUITE, 'AC7: imports what only this change adds, so the new suites fail on refactor'],
    [MAP_SUITE, 'AC7: keeps every grouped-triage test running, none of them skipped'],
  ],
};

const globToRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '(?:.*/)?')}$`,
  );

const includeGlobs = [...read('vitest.config.ts').matchAll(/'(tests\/\*\*\/[^']+)'/g)].map((match) => match[1]);
const testTitles = (source: string) => [...source.matchAll(/\bit\(\s*'([^']+)'/g)].map((match) => match[1]);

describe('grouped triage criteria map (#35 AC7)', () => {
  it('AC7: ships grouped-triage test files that the vitest run collects', () => {
    expect(JSON.parse(read('package.json')).scripts.test).toBe('vitest run');
    expect(includeGlobs.length).toBeGreaterThan(0);

    TRIAGE_SUITES.forEach((suite) => {
      expect(existsSync(path.join(REPO_ROOT, suite)), `${suite} is missing`).toBe(true);
      expect(includeGlobs.some((glob) => globToRegExp(glob).test(suite)), `${suite} is not collected`).toBe(true);
      expect(VERIFY_EXCLUSIONS).not.toContain(suite);
    });
  });

  it('AC7: maps every #35 criterion onto a test that exists', () => {
    const titlesBySuite = new Map(TRIAGE_SUITES.map((suite) => [suite, testTitles(read(suite))]));

    Object.entries(CRITERION_MAP).forEach(([criterion, entries]) => {
      entries.forEach(([suite, title]) => {
        expect(titlesBySuite.has(suite), `${criterion} names an unknown suite ${suite}`).toBe(true);
        expect(
          (titlesBySuite.get(suite) || []).includes(title),
          `${criterion} names no real test in ${suite}: ${title}`,
        ).toBe(true);
      });
    });

    // Every criterion needs at least one named test, and the criteria-tagged titles stay visible
    // in the vitest output, which is what the gate reads.
    Object.keys(CRITERION_MAP).forEach((criterion) => expect(CRITERION_MAP[criterion].length).toBeGreaterThan(0));
    const tagged = [...titlesBySuite.values()].flat().filter((title) => /^AC\d:/.test(title));
    expect(tagged.length).toBeGreaterThanOrEqual(18);
  });

  it('AC7: imports what only this change adds, so the new suites fail on refactor', () => {
    TRIAGE_MODULES.forEach((module) => {
      expect(existsSync(path.join(REPO_ROOT, module)), `${module} is missing`).toBe(true);
    });

    [COMPONENT_SUITE, QA_PROBE_SUITE].forEach((suite) => {
      expect(read(suite)).toContain("from '@/app/admin/_components/IngressTriageGroups'");
    });
    expect(read(MODEL_SUITE)).toContain("from '@/service/ingress/ingressTriageGroupsModel'");

    // The service the suites mock grew these two methods for #35; the base branch has neither.
    const service = read('src/service/ingress/IngressAutomationService.ts');
    expect(service).toContain('async getQueueGroups');
    expect(service).toContain('`/queue/groups');
    expect(service).toContain('async bulkQueueAction');
    expect(service).toContain("'/queue/bulk'");

    // And the grouped view is mounted as a tab, so the component is reachable from the page.
    expect(read('src/app/ingress-automation/page.tsx')).toContain('<IngressTriageGroups />');
  });

  it('AC7: keeps every grouped-triage test running, none of them skipped', () => {
    const forbiddenWords = ['only', 'skip', 'todo', 'xit', 'xdescribe'];

    TRIAGE_SUITES.forEach((suite) => {
      const source = read(suite);
      forbiddenWords.forEach((word) => {
        expect(new RegExp(`\\b${word}\\w*\\s*\\(`).test(source), `${suite} calls ${word}`).toBe(false);
      });
    });
  });
});
