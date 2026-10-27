import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { IngressTriagePreviewRow } from '@/app/admin/_components/ingress/IngressTriageRows';
import type { IngressQueueItem } from '@/service/ingress/IngressAutomationService';

const item: IngressQueueItem = {
  id: 'item-1',
  status: 'needs_review',
  file_path: '/ingest/dune/item-1.mkv',
  file_name: 'item-1.mkv',
  confidence_score: 61,
  attempts: 0,
  queued_at: 100,
};

const renderRow = (props: Partial<Parameters<typeof IngressTriagePreviewRow>[0]> = {}) => {
  const onReclassify = vi.fn();
  const onAssign = vi.fn();
  render(
    <IngressTriagePreviewRow
      item={item}
      groupSelected={false}
      excluded={false}
      working={false}
      onToggleExcluded={vi.fn()}
      onItemAction={vi.fn()}
      onReclassify={onReclassify}
      onAssign={onAssign}
      {...props}
    />
  );
  return { onReclassify, onAssign };
};

describe('IngressTriagePreviewRow', () => {
  it('names the classification control after the file it belongs to', () => {
    const { onReclassify } = renderRow();

    // A folder view renders one of these per preview row, so an unnamed control would be ambiguous —
    // and MUI keeps a FormControl's own aria-label on the wrapper, not on the combobox.
    const control = screen.getByRole('combobox', { name: 'Classification override for item-1.mkv' });
    expect(control).toBeInTheDocument();

    fireEvent.mouseDown(control);
    fireEvent.click(screen.getByRole('option', { name: 'Special Feature' }));
    expect(onReclassify).toHaveBeenCalledWith(item, 'special_feature');
  });

  it('offers the same manual assignment affordance the flat queue row offers', () => {
    const { onAssign } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Assign item-1.mkv manually' }));
    expect(onAssign).toHaveBeenCalledWith(item);
  });
});
