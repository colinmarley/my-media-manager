import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ConnectFileDialog from '../../src/app/dashboard/physical-media/_components/ConnectFileDialog';

const searchMediaFilesMock = vi.fn();
const connectFileToDiscMock = vi.fn();
const connectFileToTapeMock = vi.fn();

vi.mock('../../src/service/catalog/MediaFileLinkService', () => ({
  searchMediaFiles: (...args: unknown[]) => searchMediaFilesMock(...args),
  connectFileToDisc: (...args: unknown[]) => connectFileToDiscMock(...args),
  connectFileToTape: (...args: unknown[]) => connectFileToTapeMock(...args),
}));

const UNLINKED_FILE = {
  id: 'file-1',
  fileName: 'Home Movie.mkv',
  filePath: '/ark/media/jellyfin/ingest/Home Movie.mkv',
  fileSize: 100,
  detectedMediaType: 'home_video',
  assignmentStatus: 'unassigned',
  targetPath: null,
  organizationStatus: null,
  createdAt: null,
};

describe('ConnectFileDialog', () => {
  beforeEach(() => {
    searchMediaFilesMock.mockReset().mockResolvedValue([UNLINKED_FILE]);
    connectFileToDiscMock.mockReset().mockResolvedValue(UNLINKED_FILE);
    connectFileToTapeMock.mockReset().mockResolvedValue(UNLINKED_FILE);
  });

  it('searches for unlinked files on open', async () => {
    render(<ConnectFileDialog open kind="disc" targetId="disc-1" onClose={vi.fn()} onConnected={vi.fn()} />);
    await waitFor(() => {
      expect(searchMediaFilesMock).toHaveBeenCalledWith({ q: undefined, unlinked: true });
    });
    expect(await screen.findByText('Home Movie.mkv')).toBeInTheDocument();
  });

  it('shows a no-results message when the search returns nothing', async () => {
    searchMediaFilesMock.mockResolvedValue([]);
    render(<ConnectFileDialog open kind="disc" targetId="disc-1" onClose={vi.fn()} onConnected={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no unlinked files found/i)).toBeInTheDocument();
    });
  });

  it('calls connectFileToDisc when kind is disc and a result is clicked', async () => {
    const onConnected = vi.fn();
    const onClose = vi.fn();
    render(<ConnectFileDialog open kind="disc" targetId="disc-1" onClose={onClose} onConnected={onConnected} />);

    const item = await screen.findByText('Home Movie.mkv');
    fireEvent.click(item);

    await waitFor(() => {
      expect(connectFileToDiscMock).toHaveBeenCalledWith('file-1', 'disc-1');
    });
    expect(connectFileToTapeMock).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls connectFileToTape when kind is tape and a result is clicked', async () => {
    render(<ConnectFileDialog open kind="tape" targetId="tape-1" onClose={vi.fn()} onConnected={vi.fn()} />);

    const item = await screen.findByText('Home Movie.mkv');
    fireEvent.click(item);

    await waitFor(() => {
      expect(connectFileToTapeMock).toHaveBeenCalledWith('file-1', 'tape-1');
    });
    expect(connectFileToDiscMock).not.toHaveBeenCalled();
  });

  it('shows an error message when connecting fails', async () => {
    connectFileToDiscMock.mockRejectedValue(new Error('file already linked'));
    render(<ConnectFileDialog open kind="disc" targetId="disc-1" onClose={vi.fn()} onConnected={vi.fn()} />);

    const item = await screen.findByText('Home Movie.mkv');
    fireEvent.click(item);

    await waitFor(() => {
      expect(screen.getByText('file already linked')).toBeInTheDocument();
    });
  });
});
