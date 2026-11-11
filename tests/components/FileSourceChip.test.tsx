import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>{children}</a>
  )),
}));

import { SOURCE_CHIP_MAX_WIDTH, SourceCell } from '@/app/dashboard/my-library/_components/detail/FileRow';
import type { MediaFile } from '@/types/library/MediaFile.type';

const LONG = 'The Lord of the Rings: The Return of the King Extended Edition Appendices Part 2 Disc 6';

const file: MediaFile = {
  id: 'f1', fileName: 'a.mkv', filePath: '/lib/a.mkv', fileSize: 1, detectedMediaType: null, assignmentStatus: null,
  targetPath: null, organizationStatus: null, createdAt: null,
  discId: 'd1', disc: { id: 'd1', title: LONG, format: 'Blu-ray' },
};

describe('Files tab source chip', () => {
  it('caps a long disc name with an ellipsis and shows the full name in a tooltip', async () => {
    render(<table><tbody><tr><td><SourceCell file={file} /></td></tr></tbody></table>);
    const chip = screen.getByTestId('file-source-chip');
    expect(chip).toHaveAttribute('href', '/dashboard/physical-media/discs/d1');
    expect(chip).toHaveStyle({ maxWidth: `${SOURCE_CHIP_MAX_WIDTH}px` });
    expect(SOURCE_CHIP_MAX_WIDTH).toBeLessThanOrEqual(180);
    const label = chip.querySelector('.MuiChip-label') as HTMLElement;
    expect(label).toHaveStyle({ textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' });

    fireEvent.mouseOver(chip);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`${LONG} · Blu-ray`);
  });
});
