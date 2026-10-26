import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #42 — the panel has to stay split.
 *
 * The acceptance criteria ask for a panel file under ~400 lines with the logic
 * pushed into section components, hooks and a pure model module. Rendering the
 * live panel needs a backend, so the size and the wiring are pinned here
 * instead, in the same source-contract style as tests/e2e/smokeSuiteContract.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');

const read = (...segments: string[]) => readFileSync(path.join(SRC_ROOT, ...segments), 'utf8');

const panelSource = read('app', 'admin', '_components', 'IngressAutomationPanel.tsx');
const modelSource = read('service', 'ingress', 'ingressQueueModel.ts');

const SECTION_COMPONENTS = [
  'IngressStatusAlerts',
  'IngressStatusSummary',
  'IngressWatcherControlCard',
  'IngressSettingsCard',
  'IngressQueueCard',
  'IngressHistoryCard',
  'IngressManualAssignDialog',
];

// The table rows are their own section, pulled in by the queue card rather than the panel.
const NESTED_SECTIONS: Record<string, string[]> = {
  IngressQueueCard: ['IngressQueueTableRow'],
};

const HOOKS = [
  'useIngressStatus',
  'useIngressQueueSelection',
  'useIngressQueueActions',
  'useIngressWatcherControl',
  'useIngressAssignDialog',
];

describe('IngressAutomationPanel stays split (issue #42 AC1)', () => {
  it('keeps the panel file under 400 lines', () => {
    const lines = panelSource.trimEnd().split('\n').length;

    expect(lines).toBeLessThan(400);
  });

  it('delegates every visual block to a section component under ./ingress', () => {
    for (const component of SECTION_COMPONENTS) {
      expect(panelSource).toMatch(new RegExp(`from '\\./ingress/${component}'`));
    }
  });

  it('keeps the section components out of the panel file itself', () => {
    for (const component of [...SECTION_COMPONENTS, ...Object.values(NESTED_SECTIONS).flat()]) {
      const source = read('app', 'admin', '_components', 'ingress', `${component}.tsx`);

      expect(source).toContain(component);
      expect(source.length).toBeLessThan(400 * 80);
    }
  });

  it('lets a section own its own sub-sections', () => {
    for (const [component, children] of Object.entries(NESTED_SECTIONS)) {
      const source = read('app', 'admin', '_components', 'ingress', `${component}.tsx`);

      for (const child of children) {
        expect(source).toMatch(new RegExp(`from '\./${child}'`));
      }
    }
  });

  it('holds state in the ingress hooks rather than in the panel', () => {
    for (const hook of HOOKS) {
      expect(panelSource).toMatch(new RegExp(`from '@/hooks/ingress/${hook}'`));
      expect(panelSource).toContain(`${hook}(`);
    }

    // The panel is presentational: no local state and no service calls left in it.
    expect(panelSource).not.toMatch(/useState\(/);
    expect(panelSource).not.toMatch(/useEffect\(/);
    expect(panelSource).not.toContain('IngressAutomationService');
  });
});

describe('ingressQueueModel stays pure (issue #42 AC4)', () => {
  it('exports the queue logic the sections and hooks consume', () => {
    for (const name of [
      'filterSelectableQueueItemIds',
      'runQueueActionsSequentially',
      'isEpisodeMappingValid',
      'getQueueClassificationBadges',
      'getQueueActionCounts',
      'getRecentHistoryEntries',
      'formatDuration',
    ]) {
      expect(modelSource).toContain(name);
    }
  });

  it('imports nothing React, MUI or HTTP so it can be unit tested on its own', () => {
    expect(modelSource).not.toMatch(/from 'react'/);
    expect(modelSource).not.toMatch(/from '@mui/);
    expect(modelSource).not.toMatch(/\bfetch\(|axios|ApiClient/);
  });
});
