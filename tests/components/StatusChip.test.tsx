import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StatusChip, { resolveStatus } from '@/components/ui/StatusChip';
import FileTechChips, { fileTechLabels } from '@/components/ui/FileTechChips';

describe('StatusChip', () => {
  it.each([
    ['needs_review', 'warning', 'Needs review'],
    ['failed', 'error', 'Failed'],
    ['auto_assigned', 'success', 'Matched'],
    ['completed', 'success', 'Organized'],
    ['pending', 'info', 'Pending'],
    ['ignored', 'neutral', 'Ignored'],
  ])('maps %s to %s / %s', (status, tone, label) => {
    expect(resolveStatus(status)).toEqual({ tone, label });
  });

  it('humanizes unknown statuses with a neutral tone', () => {
    expect(resolveStatus('waiting_for_disc')).toEqual({ tone: 'neutral', label: 'Waiting for disc' });
    expect(resolveStatus(undefined)).toEqual({ tone: 'neutral', label: 'Unknown' });
  });

  it('renders the mapped label, and honours label / tone overrides', () => {
    const { rerender } = render(<StatusChip status="needs_review" />);
    expect(screen.getByText('Needs review').closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
    rerender(<StatusChip status="failed" label="3 failed" tone="warning" />);
    expect(screen.getByText('3 failed').closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
  });
});

describe('FileTechChips', () => {
  it('renders only the values that are present', () => {
    expect(fileTechLabels({ container: 'mkv', videoCodec: 'hevc', resolutionCategory: '4K', hdrFormat: 'HDR10', audioCodec: 'truehd', audioChannels: 8 }).map((l) => l.label))
      .toEqual(['4K', 'HDR10', 'HEVC', 'TRUEHD 7.1', 'MKV']);
    expect(fileTechLabels({ videoCodec: ' ', audioChannels: 2 }).map((l) => l.label)).toEqual(['Stereo']);
  });

  it('renders nothing without data', () => {
    const { container } = render(<FileTechChips />);
    expect(container).toBeEmptyDOMElement();
    render(<FileTechChips resolutionCategory="1080p" />);
    expect(screen.getByText('1080p')).toBeInTheDocument();
  });
});
