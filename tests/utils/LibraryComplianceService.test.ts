import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import LibraryComplianceService from '@/service/library/LibraryComplianceService';

describe('LibraryComplianceService.startScan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends movie mediaType by default', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { scanId: 'scan-1', libraryPath: '/movies', status: 'started' },
      }),
    } as Response);

    await LibraryComplianceService.startScan('/movies');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ libraryPath: '/movies', mediaType: 'movie' }));
  });

  it('sends series mediaType when selected', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { scanId: 'scan-2', libraryPath: '/shows', status: 'started' },
      }),
    } as Response);

    await LibraryComplianceService.startScan('/shows', 'series');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ libraryPath: '/shows', mediaType: 'series' }));
  });

  it('updates action target path and selection', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { action: { id: 'action-1' } },
      }),
    } as Response);

    await LibraryComplianceService.updateAction('finding-1', 'action-1', {
      selected: false,
      targetPath: '/movies/Film (2024)/Extras/Featurette.mkv',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/findings/finding-1/actions/action-1');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({
      selected: false,
      targetPath: '/movies/Film (2024)/Extras/Featurette.mkv',
    }));
  });
});
