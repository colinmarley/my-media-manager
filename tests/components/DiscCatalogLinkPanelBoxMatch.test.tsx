import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import DiscCatalogLinkPanel from '../../src/app/admin/disc-ripper/_components/DiscCatalogLinkPanel';

const createDiscMock = vi.fn();
const createReleaseMock = vi.fn();
const getReleaseMock = vi.fn();
const searchBoxesMock = vi.fn();
const searchReleasesMock = vi.fn();
const searchDiscsMock = vi.fn();

vi.mock('../../src/service/catalog/DiscCatalogService', () => ({
  createDisc: (...args: unknown[]) => createDiscMock(...args),
  createRelease: (...args: unknown[]) => createReleaseMock(...args),
  getRelease: (...args: unknown[]) => getReleaseMock(...args),
  mergeDisc: vi.fn(),
  updateRelease: vi.fn(),
  searchBoxes: (...args: unknown[]) => searchBoxesMock(...args),
  searchReleases: (...args: unknown[]) => searchReleasesMock(...args),
  searchDiscs: (...args: unknown[]) => searchDiscsMock(...args),
}));

const BOX = { id: 'box-1', title: 'Burn Notice: Season 1', discCount: 1 };
const OTHER_BOX = { id: 'box-2', title: 'burn notice: season 1', discCount: 3 };

function renderPanel(onLink = vi.fn()) {
  render(
    <DiscCatalogLinkPanel
      discTitle="Burn Notice"
      discType="dvd"
      mediaType="show"
      year={2007}
      season={1}
      volumeLabel="BURNNOTICE_S1_D2"
      linkedDisc={null}
      onLink={onLink}
      onUnlink={vi.fn()}
    />,
  );
  return onLink;
}

const nameField = () => screen.getByLabelText('Name on the box') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Create and Link' });

describe('DiscCatalogLinkPanel: joining a box by its name', () => {
  beforeEach(() => {
    createDiscMock.mockReset().mockResolvedValue({ id: 'disc-2', title: 'Burn Notice: Season 1 - Disc 2' });
    createReleaseMock.mockReset().mockResolvedValue({ id: 'box-new', title: 'x', discs: [{ id: 'disc-new', title: 'x' }] });
    getReleaseMock.mockReset().mockImplementation(async (id: string) => ({
      id, title: 'Burn Notice: Season 1', expectedDiscCount: 4, edition: 'The Complete First Season',
      discs: [{ id: 'disc-1', discNumber: 1 }],
    }));
    searchBoxesMock.mockReset().mockResolvedValue([]);
    searchReleasesMock.mockReset().mockResolvedValue([]);
    searchDiscsMock.mockReset().mockResolvedValue([]);
  });

  it('joins the one box that already has the prefilled name', async () => {
    // A box whose name only contains the text is not a match.
    searchBoxesMock.mockResolvedValue([BOX, { id: 'box-9', title: 'Burn Notice: Season 1 (Blu-ray)', discCount: 2 }]);
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));

    expect(nameField().value).toBe('Burn Notice: Season 1');
    await screen.findByText(/is a box already in your catalog \(1 disc so far\)/);
    expect(searchBoxesMock).toHaveBeenCalledWith('Burn Notice: Season 1');
    // The same effect as picking it: disc number, count and edition come from the box.
    await waitFor(() => expect((screen.getByLabelText('Disc') as HTMLInputElement).value).toBe('2'));
    expect((screen.getByLabelText('of (discs in box)') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Special version (optional)') as HTMLInputElement).value).toBe('The Complete First Season');

    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createReleaseMock).not.toHaveBeenCalled();
    expect(createDiscMock).toHaveBeenCalledWith(expect.objectContaining({ setId: 'box-1', discNumber: 2, isPartOfSet: true }));
  });

  it('matches the typed name without regard to case or outer spaces', async () => {
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));
    await waitFor(() => expect(searchBoxesMock).toHaveBeenCalledTimes(1));

    searchBoxesMock.mockResolvedValue([{ id: 'box-7', title: 'Burn Notice: The Complete First Season', discCount: 2 }]);
    fireEvent.change(nameField(), { target: { value: '  burn notice: the complete first season ' } });
    await screen.findByText(/is a box already in your catalog \(2 discs so far\)/, undefined, { timeout: 3000 });

    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createReleaseMock).not.toHaveBeenCalled();
    expect(createDiscMock).toHaveBeenCalledWith(expect.objectContaining({ setId: 'box-7' }));
  });

  it('makes a new box only when asked to', async () => {
    searchBoxesMock.mockResolvedValue([BOX]);
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));
    await screen.findByText(/is a box already in your catalog/);

    fireEvent.click(screen.getByRole('button', { name: 'Make a new box instead' }));
    await screen.findByText(/A new box will be made with a name your catalog already has/);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createDiscMock).not.toHaveBeenCalled();
    expect(createReleaseMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Burn Notice: Season 1' }));
  });

  it('does not guess between several boxes with the name', async () => {
    searchBoxesMock.mockResolvedValue([BOX, OTHER_BOX]);
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));

    await screen.findByText(/2 boxes in your catalog have this name/);
    expect(saveButton()).toBeDisabled();
    expect(getReleaseMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('burn notice: season 1 · 3 discs so far'));
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createReleaseMock).not.toHaveBeenCalled();
    expect(createDiscMock).toHaveBeenCalledWith(expect.objectContaining({ setId: 'box-2' }));
  });

  it('creates a box when the catalog has none with the name', async () => {
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));
    await waitFor(() => expect(searchBoxesMock).toHaveBeenCalled());
    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createDiscMock).not.toHaveBeenCalled();
    expect(createReleaseMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Burn Notice: Season 1' }));
  });

  it('never creates a second box when Create is pressed before the lookup has answered', async () => {
    // The lookup made when the form opens never answers; the one made on save does.
    searchBoxesMock.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue([BOX]);
    const onLink = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New disc record' }));
    fireEvent.click(saveButton());

    await screen.findByText(/A box with this name is already in your catalog\. Check the box and disc number/);
    expect(createReleaseMock).not.toHaveBeenCalled();
    expect(createDiscMock).not.toHaveBeenCalled();
    expect(onLink).not.toHaveBeenCalled();

    await waitFor(() => expect((screen.getByLabelText('Disc') as HTMLInputElement).value).toBe('2'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onLink).toHaveBeenCalled());
    expect(createReleaseMock).not.toHaveBeenCalled();
    expect(createDiscMock).toHaveBeenCalledWith(expect.objectContaining({ setId: 'box-1' }));
  });
});
