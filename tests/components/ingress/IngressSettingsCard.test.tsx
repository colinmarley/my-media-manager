import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import IngressSettingsCard from '@/app/admin/_components/ingress/IngressSettingsCard';

const renderCard = (overrides: Record<string, unknown> = {}) => {
  const props = {
    editThreshold: 85,
    onEditThresholdChange: vi.fn(),
    editAutoOrganize: true,
    onEditAutoOrganizeChange: vi.fn(),
    editAutoProcess: false,
    onEditAutoProcessChange: vi.fn(),
    savingConfig: false,
    onSaveConfig: vi.fn(),
    ...overrides,
  };

  render(<IngressSettingsCard {...(props as never)} />);

  return props;
};

describe('IngressSettingsCard', () => {
  it('shows the loaded configuration values', () => {
    renderCard();

    expect(screen.getByLabelText(/auto-assign threshold/i)).toHaveValue(85);
    expect(
      screen.getByRole('switch', { name: 'Auto-organize files on assignment' })
    ).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Auto-process queue when watcher runs' })
    ).not.toBeChecked();
  });

  it('converts the threshold input to a number before handing it back', () => {
    const props = renderCard();

    fireEvent.change(screen.getByLabelText(/auto-assign threshold/i), { target: { value: '70' } });

    expect(props.onEditThresholdChange).toHaveBeenCalledWith(70);
  });

  it('reports switch changes as booleans', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('switch', { name: 'Auto-organize files on assignment' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-process queue when watcher runs' }));

    expect(props.onEditAutoOrganizeChange).toHaveBeenCalledWith(false);
    expect(props.onEditAutoProcessChange).toHaveBeenCalledWith(true);
  });

  it('locks the save button while the config request is running', () => {
    const props = renderCard({ savingConfig: true });

    const save = screen.getByRole('button', { name: 'Saving…' });
    expect(save).toBeDisabled();

    fireEvent.click(save);
    expect(props.onSaveConfig).not.toHaveBeenCalled();
  });

  it('saves when the button is enabled', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Save Config' }));

    expect(props.onSaveConfig).toHaveBeenCalled();
  });
});
