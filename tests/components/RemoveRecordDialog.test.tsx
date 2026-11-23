import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

import RemoveRecordDialog from '../../src/app/dashboard/my-library/_components/detail/RemoveRecordDialog';
import { MediaFile } from '../../src/types/library/MediaFile.type';

const FILE = { id: 'gone', fileName: 'Old Cut.mkv', isAvailable: false } as MediaFile;

describe('RemoveRecordDialog', () => {
  it('stays closed without a file', () => {
    render(<RemoveRecordDialog file={null} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says no file is deleted, and removes only on confirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RemoveRecordDialog file={FILE} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByText('Old Cut.mkv')).toBeInTheDocument();
    expect(screen.getByText(/No file is deleted/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove record' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith(FILE);
  });

  it('cancels without removing', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<RemoveRecordDialog file={FILE} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
