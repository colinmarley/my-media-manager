import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import LibraryCompliancePanel from '@/app/admin/_components/LibraryCompliancePanel';

const mocks = vi.hoisted(() => ({
  startScan: vi.fn(),
  getScanStatus: vi.fn(),
  getSummary: vi.fn(),
  getFindings: vi.fn(),
  getFinding: vi.fn(),
  updateFindingStatus: vi.fn(),
  updateAction: vi.fn(),
  previewFinding: vi.fn(),
  applyFinding: vi.fn(),
  bulkApply: vi.fn(),
  bulkStatus: vi.fn(),
}));

vi.mock('@/service/library/LibraryComplianceService', () => ({
  default: {
    startScan: mocks.startScan,
    getScanStatus: mocks.getScanStatus,
    getSummary: mocks.getSummary,
    getFindings: mocks.getFindings,
    getFinding: mocks.getFinding,
    updateFindingStatus: mocks.updateFindingStatus,
    updateAction: mocks.updateAction,
    previewFinding: mocks.previewFinding,
    applyFinding: mocks.applyFinding,
    bulkApply: mocks.bulkApply,
    bulkStatus: mocks.bulkStatus,
  },
}));

const finding = {
  id: 'finding-1',
  scanId: 'scan-1',
  mediaType: 'movie',
  issueType: 'naming_mismatch',
  severity: 'medium' as const,
  confidence: 60,
  currentState: {},
  expectedState: {},
  rationale: 'Mismatch',
  status: 'open' as const,
  actions: [],
  filePath: '/ark/media/jellyfin/Movies/Bad Name.mkv',
  folderPath: '/ark/media/jellyfin/Movies/Bad Name',
};

function setupDefaults(): void {
  mocks.getSummary.mockResolvedValue({
    open: 1,
    critical: 0,
    high: 0,
    duplicateMain: 0,
    misplacedSpecial: 0,
    namingMismatch: 1,
    seasonNamingMismatch: 0,
    episodeNamingMismatch: 0,
    specialsMisplaced: 0,
    unknownEpisodePattern: 0,
  });
  mocks.getFindings.mockResolvedValue([finding]);
  mocks.startScan.mockResolvedValue({ scanId: 'scan-123' });
  mocks.getScanStatus.mockResolvedValue({
    scanId: 'scan-123',
    libraryPath: '/ark/media/jellyfin/Movies',
    status: 'completed',
    totalFolders: 1,
    processedFolders: 1,
    findingsCount: 1,
    percentage: 100,
  });
  mocks.getFinding.mockResolvedValue(finding);
  mocks.updateFindingStatus.mockResolvedValue({ ...finding, status: 'ignored' });
  mocks.updateAction.mockResolvedValue(undefined);
  mocks.previewFinding.mockResolvedValue({ findingId: 'finding-1', actions: [], safeToApply: true });
  mocks.applyFinding.mockResolvedValue({ finding, results: [], success: true });
  mocks.bulkApply.mockResolvedValue(undefined);
  mocks.bulkStatus.mockResolvedValue(undefined);
}

describe('LibraryCompliancePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('loads summary and findings on mount', async () => {
    render(<LibraryCompliancePanel />);

    expect(await screen.findByText('Library Compliance Audit')).toBeInTheDocument();
    expect(await screen.findByText('naming_mismatch')).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.getSummary).toHaveBeenCalled();
      expect(mocks.getFindings).toHaveBeenCalledWith({ status: 'open', limit: 200 });
    });
  });

  it('starts a movie scan by default', async () => {
    render(<LibraryCompliancePanel />);

    const input = await screen.findByLabelText('Library Path');
    fireEvent.change(input, { target: { value: '/ark/media/jellyfin/Movies' } });

    fireEvent.click(screen.getByRole('button', { name: 'Run Compliance Scan' }));

    await waitFor(() => {
      expect(mocks.startScan).toHaveBeenCalledWith('/ark/media/jellyfin/Movies', 'movie');
    });
  });

  it('starts a series scan when scan mode is switched', async () => {
    render(<LibraryCompliancePanel />);

    const comboboxes = await screen.findAllByRole('combobox');
    fireEvent.mouseDown(comboboxes[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'Series' }));

    const input = screen.getByLabelText('Library Path');
    fireEvent.change(input, { target: { value: '/ark/media/jellyfin/TV Shows' } });

    fireEvent.click(screen.getByRole('button', { name: 'Run Compliance Scan' }));

    await waitFor(() => {
      expect(mocks.startScan).toHaveBeenCalledWith('/ark/media/jellyfin/TV Shows', 'series');
    });
  });

  it('enables bulk apply after selecting a finding and dispatches apply call', async () => {
    render(<LibraryCompliancePanel />);

    await screen.findByText('naming_mismatch');

    const applySelected = screen.getByRole('button', { name: 'Apply Selected' });
    const ignoreSelected = screen.getByRole('button', { name: 'Ignore Selected' });

    expect(applySelected).toBeDisabled();
    expect(ignoreSelected).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(applySelected).toBeEnabled();
      expect(ignoreSelected).toBeEnabled();
    });

    fireEvent.click(applySelected);
    await waitFor(() => {
      expect(mocks.bulkApply).toHaveBeenCalledWith(['finding-1']);
    });
  });

  it('enables bulk ignore after selecting a finding and dispatches ignore call', async () => {
    render(<LibraryCompliancePanel />);

    await screen.findByText('naming_mismatch');

    const ignoreSelected = screen.getByRole('button', { name: 'Ignore Selected' });
    expect(ignoreSelected).toBeDisabled();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    await waitFor(() => {
      expect(ignoreSelected).toBeEnabled();
    });

    fireEvent.click(ignoreSelected);
    await waitFor(() => {
      expect(mocks.bulkStatus).toHaveBeenCalledWith(['finding-1'], 'ignored');
    });
  });

  it('allows editing action target and selection before applying', async () => {
    const findingWithActions = {
      ...finding,
      issueType: 'duplicate_main_feature',
      actions: [
        {
          id: 'action-1',
          actionType: 'move',
          sourcePath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Movie Name (2024) [1080p].mkv',
          targetPath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Alt/Movie Name (2024) [1080p].mkv',
          payload: {},
          selected: true,
        },
      ],
    };

    mocks.getFinding.mockResolvedValueOnce(findingWithActions).mockResolvedValueOnce(findingWithActions);

    render(<LibraryCompliancePanel />);
    await screen.findByText('naming_mismatch');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByText('duplicate_main_feature');

    const targetInput = screen.getByLabelText('Target path');
    fireEvent.change(targetInput, {
      target: {
        value: '/ark/media/jellyfin/Movies/Movie Name (2024)/Extras/Custom Name.mkv',
      },
    });

    const keepFilenameButton = screen.getByRole('button', { name: 'Keep filename' });
    fireEvent.click(keepFilenameButton);

    const selectedCheckboxes = screen.getAllByRole('checkbox');
    fireEvent.click(selectedCheckboxes[selectedCheckboxes.length - 1]);

    fireEvent.click(screen.getByRole('button', { name: 'Save Action Changes' }));

    await waitFor(() => {
      expect(mocks.updateAction).toHaveBeenCalledWith(
        'finding-1',
        'action-1',
        {
          selected: false,
          targetPath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Alt/Movie Name (2024) [1080p].mkv',
        },
      );
    });
  });

  it('persists edited target path before applying selected fixes', async () => {
    const findingWithActions = {
      ...finding,
      issueType: 'misplaced_special_feature',
      actions: [
        {
          id: 'action-1',
          actionType: 'move',
          sourcePath: '/ark/media/jellyfin/Movies/Movie Name (2024)/featurette.mkv',
          targetPath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Extras/featurette.mkv',
          payload: {},
          selected: true,
        },
      ],
    };

    const findingAfterSave = {
      ...findingWithActions,
      actions: [
        {
          ...findingWithActions.actions[0],
          targetPath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Featurettes/Custom Featurette.mkv',
        },
      ],
    };

    mocks.getFinding
      .mockResolvedValueOnce(findingWithActions)
      .mockResolvedValueOnce(findingAfterSave)
      .mockResolvedValueOnce(findingAfterSave);

    render(<LibraryCompliancePanel />);
    await screen.findByText('naming_mismatch');

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByText('misplaced_special_feature');

    const targetInput = screen.getByLabelText('Target path');
    fireEvent.change(targetInput, {
      target: {
        value: '/ark/media/jellyfin/Movies/Movie Name (2024)/Featurettes/Custom Featurette.mkv',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected Fixes' }));

    await waitFor(() => {
      expect(mocks.updateAction).toHaveBeenCalledWith(
        'finding-1',
        'action-1',
        {
          selected: true,
          targetPath: '/ark/media/jellyfin/Movies/Movie Name (2024)/Featurettes/Custom Featurette.mkv',
        },
      );
    });

    await waitFor(() => {
      expect(mocks.applyFinding).toHaveBeenCalledWith('finding-1');
    });
  });
});
