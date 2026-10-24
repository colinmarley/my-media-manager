import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Issue #19, review finding 1: the smoke walkthrough reads a card's title with
 * `card.locator('.MuiCardContent-root').getByRole('heading', { level: 6 })`.
 *
 * That lookup is only unique because of where the library card puts its two
 * headings: MUI renders BOTH `variant="subtitle1"` (the poster fallback, shown when the
 * poster 404s) and `variant="h6"` (the card title) as `<h6>`, so a fallback title inside
 * the card body would make the locator resolve to two nodes and fail the run.
 *
 * These tests pin that structure in the page, so a card refactor that moves the fallback
 * inside the card body — or a card-title heading that is not an `<h6>` — fails here rather
 * than in a smoke run against a live deployment.
 */

const ROOT = path.resolve(__dirname, '../..');
const LIBRARY_PAGE = path.join(ROOT, 'src/app/dashboard/my-library/page.tsx');
const SHELL = path.join(ROOT, 'src/app/layout.tsx');

const librarySource = readFileSync(LIBRARY_PAGE, 'utf-8');

const linkStart = librarySource.indexOf('<CardActionArea');
const linkEnd = librarySource.indexOf('</CardActionArea>', linkStart);
const card = librarySource.slice(linkStart, linkEnd);

const bodyStart = card.indexOf('<CardContent');
const bodyEnd = card.indexOf('</CardContent>', bodyStart);
const cardBody = card.slice(bodyStart, bodyEnd);
const outsideCardBody = card.slice(0, bodyStart);

describe('the library card title lookup the smoke walkthrough depends on (issue #19)', () => {
  it('renders the card as a link with a card body to scope the lookup to', () => {
    expect(linkStart, 'the library card is no longer a CardActionArea link').toBeGreaterThan(-1);
    expect(bodyStart, 'the library card no longer has a CardContent body').toBeGreaterThan(-1);
  });

  it('puts exactly one heading in the card body, at the level the smoke asks for', () => {
    expect(cardBody.match(/variant="h6"/g)).toHaveLength(1);
  });

  it('keeps the poster fallback heading outside the card body, where it cannot double-match', () => {
    expect(outsideCardBody).toContain('posterFallbackTitle');
    // MUI maps subtitle1 to an <h6>, which is what makes the fallback a second candidate.
    expect(outsideCardBody).toMatch(/variant="subtitle1"/);
    expect(cardBody).not.toMatch(/variant="subtitle1"/);
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
  const sliceCard = (source: string) => {
    const start = source.indexOf('<CardActionArea');
    const card = source.slice(start, source.indexOf('</CardActionArea>', start));
    const bodyStart = card.indexOf('<CardContent');
    const bodyEnd = card.indexOf('</CardContent>', bodyStart);
    return { cardBody: card.slice(bodyStart, bodyEnd), outsideCardBody: card.slice(0, bodyStart) };
  };

  it('catches the poster fallback moving into the card body', () => {
    const mutated = librarySource.replace(
      '<Typography variant="h6" sx={styles.cardTitle}>',
      '<Typography variant="subtitle1" sx={styles.posterFallbackTitle}>{folderDisplayName}</Typography>\n                    <Typography variant="h6" sx={styles.cardTitle}>',
    );
    expect(mutated).not.toBe(librarySource);
    expect(sliceCard(mutated).cardBody).toMatch(/variant="subtitle1"/);
  });

  it('catches the card title stopping being a level-6 heading', () => {
    const mutated = librarySource.replace('variant="h6" sx={styles.cardTitle}', 'variant="h5" sx={styles.cardTitle}');
    expect(mutated).not.toBe(librarySource);
    expect(sliceCard(mutated).cardBody.match(/variant="h6"/g)).toBeNull();
  });

  it('catches a trailing slash on the shell nav href', () => {
    const mutated = readFileSync(SHELL, 'utf-8').replace(
      "href: '/dashboard/my-library'",
      "href: '/dashboard/my-library/'",
    );
    expect(mutated).toMatch(/href: '\/dashboard\/my-library\/'/);
  });
});
