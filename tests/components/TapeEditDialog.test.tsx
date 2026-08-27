import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import TapeEditDialog from '../../src/app/dashboard/physical-media/_components/TapeEditDialog';
import { CatalogTape } from '../../src/types/catalog/Tape.type';

const createTapeMock = vi.fn();
const updateTapeMock = vi.fn();

vi.mock('../../src/service/catalog/TapeCatalogService', () => ({
  createTape: (...args: unknown[]) => createTapeMock(...args),
  updateTape: (...args: unknown[]) => updateTapeMock(...args),
}));

const EXISTING_TAPE: CatalogTape = {
  id: 'tape-1',
  title: 'Family Vacation 1996',
  videoFiles: [],
  imageFiles: [],
  tapeType: 'vhs',
  tapeLabel: 'VHS_0007',
  brand: 'TDK',
  condition: 'fair',
};

describe('TapeEditDialog', () => {
  beforeEach(() => {
    createTapeMock.mockReset().mockResolvedValue({ id: 'new-tape', title: 'New Tape' });
    updateTapeMock.mockReset().mockResolvedValue({ id: 'tape-1', title: 'Updated' });
  });

  it('renders in create mode with empty fields', () => {
    render(<TapeEditDialog open tape={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('New Tape')).toBeInTheDocument();
    expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('');
  });

  it('pre-fills fields in edit mode', () => {
    render(<TapeEditDialog open tape={EXISTING_TAPE} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText('Edit Tape')).toBeInTheDocument();
    expect(screen.getByLabelText('Title', { exact: false })).toHaveValue('Family Vacation 1996');
    expect(screen.getByLabelText('Physical Label')).toHaveValue('VHS_0007');
  });

  it('shows an error and does not save when title is empty', async () => {
    render(<TapeEditDialog open tape={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /create tape/i }));
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
    });
    expect(createTapeMock).not.toHaveBeenCalled();
  });

  it('calls createTape with the entered title and label on save', async () => {
    const onSaved = vi.fn();
    render(<TapeEditDialog open tape={null} onClose={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Birthday Party 1998' } });
    fireEvent.change(screen.getByLabelText('Physical Label'), { target: { value: 'VHSC_0002' } });
    fireEvent.click(screen.getByRole('button', { name: /create tape/i }));

    await waitFor(() => {
      expect(createTapeMock).toHaveBeenCalledTimes(1);
    });
    expect(createTapeMock.mock.calls[0][0]).toMatchObject({
      title: 'Birthday Party 1998',
      tapeLabel: 'VHSC_0002',
    });
    expect(onSaved).toHaveBeenCalledWith({ id: 'new-tape', title: 'New Tape' });
  });

  it('calls updateTape with the tape id on save in edit mode', async () => {
    render(<TapeEditDialog open tape={EXISTING_TAPE} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title', { exact: false }), { target: { value: 'Family Vacation (Restored)' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(updateTapeMock).toHaveBeenCalledTimes(1);
    });
    expect(updateTapeMock.mock.calls[0][0]).toBe('tape-1');
    expect(updateTapeMock.mock.calls[0][1]).toMatchObject({ title: 'Family Vacation (Restored)' });
  });
});
