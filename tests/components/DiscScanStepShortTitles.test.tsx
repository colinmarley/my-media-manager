import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import DiscScanStep from '../../src/app/admin/disc-ripper/_components/DiscScanStep';
import type { DiscScanInfo, DiscTitle } from '../../src/types/disc-ripper/DiscRipper.type';

const getDiscInfoMock = vi.fn();

vi.mock('../../src/service/disc-ripper/DiscRipperService', () => ({
  DiscRipperService: {
    getDiscInfo: (...args: unknown[]) => getDiscInfoMock(...args),
    formatBytes: (n: number) => `${n} B`,
    formatDuration: (n: number) => `${n}s`,
  },
}));

vi.mock('../../src/service/catalog/DiscCatalogService', () => ({
  findRipsByFingerprint: vi.fn().mockResolvedValue([]),
}));

const TITLE: DiscTitle = {
  index: 0, name: '', duration_seconds: 1320, chapter_count: 5, file_size_bytes: 1_000_000_000,
  output_filename: 't00.mkv', width: 720, height: 480, codec: 'Mpeg2',
};

const SCAN: DiscScanInfo = {
  scan_id: 'scan-1', scanned_at: null, fingerprint: 'f'.repeat(64), disc_type: 'DVD disc', disc_name: 'OFFICE_S1',
  volume_label: 'OFFICE_S1_D1', drive_model: null, makemkv_version: 'MakeMKV v1.18.1', title_count: 1,
  skipped_short: 23,
};

function renderStep(scanInfo: DiscScanInfo | null, handlers: { onScanned?: (info: DiscScanInfo | null) => void } = {}) {
  const setTitles = vi.fn();
  render(
    <DiscScanStep
      titles={scanInfo ? [TITLE] : []}
      setTitles={setTitles}
      scanError=""
      setScanError={vi.fn()}
      scanInfo={scanInfo}
      previousRips={[]}
      onScanned={handlers.onScanned}
      onPreviousRips={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  return { setTitles };
}

describe('DiscScanStep: short titles', () => {
  beforeEach(() => {
    getDiscInfoMock.mockReset();
  });

  it('scans with the ripper\'s own minimum by default', async () => {
    getDiscInfoMock.mockResolvedValue({ titles: [TITLE], error: null, disc: SCAN });
    renderStep(null);
    fireEvent.click(screen.getByRole('button', { name: 'Scan Disc' }));
    await waitFor(() => expect(getDiscInfoMock).toHaveBeenCalledTimes(1));
    expect(getDiscInfoMock).toHaveBeenCalledWith(undefined);
  });

  it('offers a rescan that includes the short titles the scan skipped', async () => {
    const withShort = [TITLE, { ...TITLE, index: 1, duration_seconds: 56 }];
    const rescanned = { ...SCAN, scan_id: 'scan-2', skipped_short: 0, min_length_seconds: 0 };
    getDiscInfoMock.mockResolvedValue({ titles: withShort, error: null, disc: rescanned });
    const onScanned = vi.fn();
    const { setTitles } = renderStep(SCAN, { onScanned });

    expect(screen.getByText(/23 short title\(s\) skipped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show short titles' }));

    await waitFor(() => expect(setTitles).toHaveBeenCalledWith(withShort));
    expect(getDiscInfoMock).toHaveBeenCalledWith({ minLengthSeconds: 0 });
    expect(onScanned).toHaveBeenLastCalledWith(rescanned);
    expect(screen.queryByText(/cannot include short titles/)).not.toBeInTheDocument();
  });

  it('does not offer it when nothing was skipped or the short titles are already listed', () => {
    renderStep({ ...SCAN, skipped_short: 0 });
    expect(screen.queryByRole('button', { name: 'Show short titles' })).not.toBeInTheDocument();
  });

  it('says the short titles are included after such a scan', () => {
    renderStep({ ...SCAN, skipped_short: 2, min_length_seconds: 0 });
    expect(screen.getByText(/short titles included/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show short titles' })).not.toBeInTheDocument();
  });

  it('says so when the ripper is an older build that ignores the request', async () => {
    // An old ripper scans as usual and reports no minimum length.
    getDiscInfoMock.mockResolvedValue({ titles: [TITLE], error: null, disc: SCAN });
    renderStep(SCAN);
    fireEvent.click(screen.getByRole('button', { name: 'Show short titles' }));
    await screen.findByText(/cannot include short titles/);
    expect(screen.queryByRole('button', { name: 'Show short titles' })).not.toBeInTheDocument();
  });
});
