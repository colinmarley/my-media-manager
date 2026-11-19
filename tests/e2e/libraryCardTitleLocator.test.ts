import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #19, review finding 1: the smoke walkthrough reads a library card's title and
 * then expects the detail page to show the same text.
 *
 * A card prints a name in two places: the catalog title under the poster, and, when the
 * poster 404s, the folder name on the placeholder that stands in for it. Only the first
 * is the title. The smoke therefore looks the title up by test id
 * (`card.getByTestId('library-card-title')`), and these tests pin the markup that lookup
 * depends on, so a card refactor fails here rather than in a smoke run against a live
 * deployment.
 */

const ROOT = path.resolve(__dirname, '../..');
const TITLE_CARD = path.join(ROOT, 'src/app/dashboard/my-library/_components/TitleCard.tsx');
const LIBRARY_PAGE = path.join(ROOT, 'src/app/dashboard/my-library/page.tsx');
// The app shell's nav hrefs live in its config, not in the root layout.
const SHELL = path.join(ROOT, 'src/components/shell/navConfig.ts');
const TITLE_TEST_ID = 'data-testid="library-card-title"';

const cardSource = readFileSync(TITLE_CARD, 'utf-8');

const slicePlaceholder = (source: string) => {
  const start = source.indexOf('export const PosterPlaceholder');
  return source.slice(start, source.indexOf('export const posterFrameSx', start));
};

const countTitleIds = (source: string) => source.split(TITLE_TEST_ID).length - 1;

describe('the library card title lookup the smoke walkthrough depends on (issue #19)', () => {
  it('renders the card as a link the smoke card locator can find', () => {
    expect(cardSource).toMatch(/component=\{Link\}\s+href=\{href\}/);
    const pageSource = readFileSync(LIBRARY_PAGE, 'utf-8');
    expect(pageSource).toContain('<TitleCard');
    expect(pageSource).toMatch(/href=\{`\/dashboard\/my-library\/\$\{item\.mediaType\}\//);
  });

  it('marks exactly one element in the card as the title', () => {
    expect(countTitleIds(cardSource)).toBe(1);
  });

  it('keeps the title test id off the poster placeholder, which shows the folder name', () => {
    const placeholder = slicePlaceholder(cardSource);
    expect(placeholder.length).toBeGreaterThan(0);
    expect(placeholder).not.toContain(TITLE_TEST_ID);
  });

  it('does not let the app shell nav match the smoke card locator', () => {
    // The locator is a[href^="/dashboard/my-library/"]; a trailing slash in the nav href
    // would put the shell link first in DOM order on every dashboard page.
    const shellSource = readFileSync(SHELL, 'utf-8');
    expect(shellSource).toMatch(/href: '\/dashboard\/my-library'/);
    expect(shellSource).not.toMatch(/href: '\/dashboard\/my-library\/'/);
  });
});

/**
 * Keeps the guards above load-bearing: each one is checked against a mutated copy of the
 * card markup, so a card refactor that reintroduces the ambiguity cannot pass by the
 * slice boundaries silently stopping matching anything.
 */
describe('the library card guards fail when the card structure changes', () => {
  it('catches a second element claiming to be the title', () => {
    const mutated = cardSource.replace('data-testid="poster-placeholder"', TITLE_TEST_ID);
    expect(mutated).not.toBe(cardSource);
    expect(countTitleIds(mutated)).toBe(2);
    expect(slicePlaceholder(mutated)).toContain(TITLE_TEST_ID);
  });

  it('catches the title losing its test id', () => {
    const mutated = cardSource.replace(TITLE_TEST_ID, '');
    expect(mutated).not.toBe(cardSource);
    expect(countTitleIds(mutated)).toBe(0);
  });

  it('catches a trailing slash on the shell nav href', () => {
    const mutated = readFileSync(SHELL, 'utf-8').replace(
      "href: '/dashboard/my-library'",
      "href: '/dashboard/my-library/'",
    );
    expect(mutated).toMatch(/href: '\/dashboard\/my-library\/'/);
  });
});
