import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import ChangeExtraTypeDialog from '../../src/app/dashboard/my-library/_components/detail/ChangeExtraTypeDialog';
import { ApiError } from '../../src/service/api/apiClient';
import { MediaFile } from '../../src/types/library/MediaFile.type';

const changeExtraType = vi.hoisted(() => vi.fn());

vi.mock('../../src/service/library/MediaFilesService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/service/library/MediaFilesService')>()),
  changeExtraType,
}));

const FILE = { id: 'x1', fileName: 'Burn Notice (2007) 8-scene.mkv', role: 'extra' } as MediaFile;

const result = (newName: string, sidecars: { from: string; to: string }[] = []) => ({
  fileId: 'x1',
  category: 'featurette',
  currentCategory: 'scene',
  currentName: FILE.fileName,
  newName,
  applied: false,
  sidecars,
  sidecarErrors: [],
  nfoTitleUpdated: false,
  file: null,
});

const pick = (label: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Type' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: label }));
};

describe('ChangeExtraTypeDialog', () => {
  beforeEach(() => {
    changeExtraType.mockReset();
  });

  it('stays closed without a file', () => {
    render(<ChangeExtraTypeDialog file={null} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changeExtraType).not.toHaveBeenCalled();
  });

  it('offers every type and cannot change before one is picked', () => {
    render(<ChangeExtraTypeDialog file={FILE} onClose={() => {}} onConfirm={vi.fn()} />);
    expect(screen.getByText(FILE.fileName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change type' })).toBeDisabled();
    expect(changeExtraType).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Type' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Behind the Scenes', 'Deleted Scene', 'Interview', 'Featurette', 'Trailer', 'Scene', 'Sample', 'Short',
      'Clip', 'Blooper', 'Other',
    ]);
  });

  it('previews the new name with a dry run, then changes only on confirm', async () => {
    changeExtraType.mockResolvedValue(
      result('Burn Notice (2007) 2-featurette.mkv', [{ from: 'a.nfo', to: 'b.nfo' }]),
    );
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ChangeExtraTypeDialog file={FILE} onClose={onClose} onConfirm={onConfirm} />);

    pick('Featurette');
    expect(await screen.findByLabelText('New file name')).toHaveTextContent('Burn Notice (2007) 2-featurette.mkv');
    expect(screen.getByText(/1 file next to it/)).toBeInTheDocument();
    expect(changeExtraType).toHaveBeenCalledTimes(1);
    expect(changeExtraType).toHaveBeenCalledWith('x1', 'featurette', true);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Change type' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledWith(FILE, 'featurette');
    // The dialog itself only ever asks for the dry run.
    expect(changeExtraType).toHaveBeenCalledTimes(1);
  });

  it('shows why a type is refused and keeps the change disabled', async () => {
    changeExtraType.mockRejectedValue(
      new ApiError(409, JSON.stringify({ detail: { code: 'SAME_TYPE', message: "This file already has the type 'scene'." } })),
    );
    render(<ChangeExtraTypeDialog file={FILE} onClose={() => {}} onConfirm={vi.fn()} />);
    pick('Scene');
    expect(await screen.findByText("This file already has the type 'scene'.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change type' })).toBeDisabled();
  });

  it('cancels without changing', async () => {
    changeExtraType.mockResolvedValue(result('Burn Notice (2007)-blooper.mkv'));
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ChangeExtraTypeDialog file={FILE} onClose={onClose} onConfirm={onConfirm} />);
    pick('Blooper');
    await screen.findByLabelText('New file name');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
