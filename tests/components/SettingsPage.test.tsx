import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockSearch = '';
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>{children}</a>
  )),
}));

const getConfig = vi.hoisted(() => vi.fn());
const getSettings = vi.hoisted(() => vi.fn());
vi.mock('@/service/ingress/IngressAutomationService', () => ({ default: { getConfig, updateConfig: vi.fn() } }));
vi.mock('@/service/tape-ingest/TapeIngestService', () => ({ default: { getSettings, saveSettings: vi.fn() } }));

import SettingsPage from '@/app/settings/page';

describe('Settings page', () => {
  beforeEach(() => {
    mockSearch = '';
    replace.mockReset();
    getConfig.mockReset().mockResolvedValue({ defaultIngressPaths: ['/data/media/encoded'], jellyfinDestBase: '/ark/media/jellyfin' });
    getSettings.mockReset().mockResolvedValue({ ingress_folder: '/ark/media/ingest', destination_base: '/ark/media/jellyfin', ffmpeg_crf: 20, ffmpeg_preset: 'medium' });
  });

  it('opens on the Ingest tab by default', async () => {
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ingest' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('Destination (Jellyfin) Folder')).toHaveValue('/ark/media/jellyfin');
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('selects the tab named in ?tab= (the /admin/settings redirect target)', async () => {
    mockSearch = 'tab=tape';
    render(<SettingsPage />);
    expect(screen.getByRole('tab', { name: 'Tape' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByLabelText('Ingest Folder')).toHaveValue('/ark/media/ingest');
  });

  it('links the Library & Naming tab to the library settings', () => {
    mockSearch = 'tab=library';
    render(<SettingsPage />);
    expect(screen.getByRole('link', { name: 'Open library settings' })).toHaveAttribute('href', '/admin/library?tab=settings');
  });

  it('writes the chosen tab to the URL and falls back to Ingest for unknown tabs', () => {
    mockSearch = 'tab=bogus';
    render(<SettingsPage />);
    expect(screen.getByRole('tab', { name: 'Ingest' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Tape' }));
    expect(replace).toHaveBeenCalledWith('/settings?tab=tape', { scroll: false });
  });
});
