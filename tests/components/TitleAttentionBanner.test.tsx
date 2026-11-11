import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: React.forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a ref={ref} href={typeof href === 'string' ? href : href.pathname} {...rest}>{children}</a>
  )),
}));

import TitleAttentionBanner from '@/components/attention/TitleAttentionBanner';
import { attentionItem } from '../utils/attentionFixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const stub = (response: () => Response) => {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('TitleAttentionBanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('summarizes the title’s items and links to the filtered To-Do list', async () => {
    const items = [
      attentionItem(),
      attentionItem({ id: 'b', subjectId: 'f2' }),
      attentionItem({ id: 'c', kind: 'needs_review', reasons: ['flagged'], dismissible: false }),
    ];
    const fetchMock = stub(() => json({ items, total: 3 }));
    render(<TitleAttentionBanner catalogType="movie" mediaId="m1" />);

    expect(await screen.findByText('2 files need renaming · 1 flagged for a second look')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open To-Do' })).toHaveAttribute('href', '/organize/todo?mediaType=movie&mediaId=m1');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/backend/api/attention/items?mediaType=movie&mediaId=m1&limit=500&offset=0');
  });

  it('renders nothing without items, on an older server, or before the title is known', async () => {
    const fetchMock = stub(() => json({ items: [], total: 0 }));
    const { container, rerender } = render(<TitleAttentionBanner catalogType="movie" mediaId="m1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();

    vi.unstubAllGlobals();
    const notFound = stub(() => new Response('Not Found', { status: 404 }));
    rerender(<TitleAttentionBanner catalogType="series" mediaId="s1" />);
    await waitFor(() => expect(notFound).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();

    vi.unstubAllGlobals();
    const unused = stub(() => json({ items: [attentionItem()], total: 1 }));
    render(<TitleAttentionBanner catalogType={null} mediaId="m1" />);
    expect(unused).not.toHaveBeenCalled();
  });

  it('refetches when the refresh key changes', async () => {
    const fetchMock = stub(() => json({ items: [attentionItem()], total: 1 }));
    const { rerender } = render(<TitleAttentionBanner catalogType="movie" mediaId="m1" refreshKey={1} />);
    expect(await screen.findByText('1 file needs renaming')).toBeInTheDocument();
    rerender(<TitleAttentionBanner catalogType="movie" mediaId="m1" refreshKey={2} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
