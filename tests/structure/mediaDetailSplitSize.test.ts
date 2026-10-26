/**
 * AC1 of #13 is a size budget ("neither file over about 400 lines"), so make it checkable
 * rather than a code-review opinion: every file produced by the media details split — the
 * composition root, the section components, the data hooks and the extracted model helpers —
 * must stay within 400 lines. This fails on the pre-split page (1,465 lines).
 *
 * The other half of #13 (`IngressAutomationPanel.tsx`, 659 lines) was recut into #42, so it is
 * deliberately not asserted here; that would couple this branch to another issue's branch.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const LINE_BUDGET = 400;

const SPLIT_FILES = [
  'src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx',
  'src/service/library/mediaDetailModel.ts',
  'src/service/library/mediaFolderFiles.ts',
];

const SPLIT_DIRECTORIES = [
  'src/app/dashboard/my-library/_components/detail',
  'src/hooks/library',
];

const sourceFilesIn = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFilesIn(full);
    }

    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });

const splitFiles = [
  ...SPLIT_FILES.map((file) => path.join(REPO_ROOT, file)),
  ...SPLIT_DIRECTORIES.flatMap(sourceFilesIn),
].map((file) => path.relative(REPO_ROOT, file));

describe('media details split size budget (#13 AC1)', () => {
  it('covers the composition root, every section component and every library hook', () => {
    expect(splitFiles).toEqual(
      expect.arrayContaining([
        'src/app/dashboard/my-library/[mediaType]/[mediaId]/page.tsx',
        'src/app/dashboard/my-library/_components/detail/MediaOverviewCard.tsx',
        'src/app/dashboard/my-library/_components/detail/EpisodeAssignDialog.tsx',
        'src/hooks/library/useMediaDetailRecord.ts',
        'src/hooks/library/useEpisodeAssignment.ts',
      ]),
    );
    expect(splitFiles.length).toBeGreaterThanOrEqual(20);
  });

  it.each(splitFiles)('%s stays within the 400 line budget', (file) => {
    const lineCount = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n').length;

    expect(lineCount).toBeLessThanOrEqual(LINE_BUDGET);
  });
});
