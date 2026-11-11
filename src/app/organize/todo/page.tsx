'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, Button, Chip, CircularProgress, InputAdornment, Skeleton, Stack, TextField, Typography } from '@mui/material';
import { CloudOffOutlined, DriveFileRenameOutlineOutlined, RefreshOutlined, SearchOutlined, TaskAltOutlined } from '@mui/icons-material';

import EmptyState from '@/components/ui/EmptyState';
import { PageContainer, PageHeader } from '@/components/ui/PageHeader';
import useAttentionItems from '@/hooks/attention/useAttentionItems';
import useAttentionSummary from '@/hooks/attention/useAttentionSummary';
import {
  countByKind,
  defaultKind,
  filterItems,
  INGEST_QUEUE_PATH,
  isRenamableFile,
  kindMeta,
} from '@/service/attention/attentionModel';
import type { AttentionKind } from '@/types/attention/Attention.type';
import DismissedList from './_components/DismissedList';
import TodoDialogs from './_components/TodoDialogs';
import TodoItemTable from './_components/TodoItemTable';
import TodoKindTabs, { todoPanelId, todoTabId } from './_components/TodoKindTabs';
import useTodoActions from './_components/useTodoActions';
import useTodoFilters, { DISMISSED_VIEW, type TodoView } from './_components/useTodoFilters';

/** Title mode loads every item of the title at once; the API caps a page at 500. */
const TITLE_PAGE_SIZE = 500;

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function TodoPage() {
  const { view: urlView, titleFilter, setView, clearTitleFilter } = useTodoFilters();
  const summary = useAttentionSummary();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Title mode: one request for all of the title's items, counted and filtered here. Otherwise
  // the summary gives the counts and each kind is loaded on its own.
  const titleMode = Boolean(titleFilter);
  const summaryKind = summary.summary ? defaultKind(summary.summary.counts) : null;
  const listKind: AttentionKind | null = urlView && urlView !== DISMISSED_VIEW ? urlView : titleMode ? null : summaryKind;

  const items = useAttentionItems({
    kind: titleMode ? null : listKind,
    mediaType: titleFilter?.mediaType,
    mediaId: titleFilter?.mediaId,
    pageSize: titleMode ? TITLE_PAGE_SIZE : undefined,
    enabled: !summary.unsupported && (titleMode || (urlView !== DISMISSED_VIEW && listKind !== null)),
  });

  const counts = titleMode ? (items.loading ? null : countByKind(items.items)) : summary.summary?.counts ?? null;
  const view: TodoView = urlView ?? (titleMode && counts ? defaultKind(counts) : listKind ?? 'needs_assignment');
  const kind = view === DISMISSED_VIEW ? null : view;

  const { refetch: refetchItems } = items;
  const { refresh: refreshSummary } = summary;
  const refetch = useCallback(() => Promise.all([refetchItems(), refreshSummary()]), [refetchItems, refreshSummary]);
  const actions = useTodoActions({ refetch });

  useEffect(() => setSelected(new Set()), [view, titleFilter?.mediaId]);

  const visible = useMemo(() => {
    const ofKind = titleMode ? items.items.filter((item) => item.kind === kind) : items.items;
    return filterItems(ofKind, query);
  }, [items.items, kind, query, titleMode]);

  const renamable = visible.filter((item) => selected.has(item.id) && isRenamableFile(item));
  const titleName = titleMode ? items.items.find((item) => item.mediaTitle)?.mediaTitle ?? 'this title' : null;
  const allClear = !titleMode && summary.summary !== null && Object.values(summary.summary.counts).every((n) => n === 0);
  const unsupported = summary.unsupported || items.unsupported;

  const header = (
    <PageHeader
      title="To-Do"
      subtitle="Files and titles that need assignment, renaming or a second look, so the library stays organized."
      actions={(
        <>
          {summary.lastCheckedAt !== null && (
            <Typography variant="caption" color="text.secondary" aria-live="polite">Last checked {formatTime(summary.lastCheckedAt)}</Typography>
          )}
          <Button
            variant="outlined"
            onClick={() => void refetch()}
            disabled={unsupported}
            startIcon={items.loading || summary.status === 'loading' ? <CircularProgress size={14} color="inherit" /> : <RefreshOutlined />}
          >
            Refresh
          </Button>
        </>
      )}
    />
  );

  if (unsupported) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={<CloudOffOutlined />}
          title="The To-Do list is not available yet"
          description="This server does not support the To-Do list yet. Update the backend to see files that need assignment, renaming or a second look."
        />
      </PageContainer>
    );
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });

  const meta = kind ? kindMeta(kind) : null;
  const loadingList = kind !== null && (items.loading || (!titleMode && !summary.summary && !urlView));

  let body: React.ReactNode;
  if (view === DISMISSED_VIEW) {
    body = <DismissedList onRestore={actions.restore} busy={actions.busy} />;
  } else if (loadingList) {
    body = <Skeleton variant="rounded" height={160} aria-label="Loading To-Do items" />;
  } else if (allClear && items.items.length === 0) {
    body = (
      <EmptyState
        icon={<TaskAltOutlined />}
        title="All organized"
        description="Nothing needs assignment, renaming or a second look right now."
      />
    );
  } else if (visible.length === 0) {
    body = query.trim()
      ? <EmptyState compact title="No matches" description={`Nothing in ${meta?.label ?? 'this list'} matches “${query.trim()}”.`} />
      : <EmptyState compact icon={meta ? <meta.icon /> : undefined} title={meta?.emptyText ?? 'Nothing here'} description={titleMode ? `For ${titleName}.` : undefined} />;
  } else {
    body = (
      <>
        {kind === 'needs_rename' && visible.some(isRenamableFile) && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<DriveFileRenameOutlineOutlined />}
              disabled={renamable.length === 0 || actions.busy}
              onClick={() => actions.renameMany(renamable)}
            >
              Rename selected{renamable.length > 0 ? ` (${renamable.length})` : ''}
            </Button>
            <Typography variant="caption" color="text.secondary">Previews every selected file first; conflicts are skipped.</Typography>
          </Stack>
        )}
        {kind === 'needs_assignment' && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            Files still in ingest can also be assigned in bulk from <Link href={INGEST_QUEUE_PATH}>Queue &amp; Review</Link>.
          </Typography>
        )}
        <TodoItemTable
          items={visible}
          label={meta?.label ?? 'To-Do items'}
          selectable={kind === 'needs_rename' ? isRenamableFile : undefined}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          busy={actions.busy}
          onAction={actions.perform}
          onDismiss={actions.onDismiss}
        />
        {!titleMode && items.hasMore && !query.trim() && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Button onClick={() => void items.loadMore()} disabled={items.loadingMore}>
              {items.loadingMore ? 'Loading…' : `Show more (${(items.total - items.items.length).toLocaleString()} left)`}
            </Button>
          </Box>
        )}
      </>
    );
  }

  return (
    <PageContainer>
      {header}
      {(summary.error || items.error) && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => void refetch()}>Retry</Button>}>
          Could not load the To-Do list: {items.error ?? summary.error}
        </Alert>
      )}
      <TodoKindTabs value={view} counts={counts} onChange={setView} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ my: 2 }}>
        <TextField
          size="small"
          label="Search titles and files"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={view === DISMISSED_VIEW}
          sx={{ minWidth: 280 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> } }}
        />
        {titleFilter && (
          <Chip label={`Title: ${titleName}`} onDelete={clearTitleFilter} aria-label={`Showing only ${titleName}. Remove filter`} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
        )}
        {meta && <Typography variant="body2" color="text.secondary">{meta.description}</Typography>}
      </Stack>
      <Box role="tabpanel" id={todoPanelId(view)} aria-labelledby={todoTabId(view)}>
        {body}
      </Box>
      <TodoDialogs actions={actions} refetch={refetch} />
    </PageContainer>
  );
}

export default function TodoRoute() {
  return (
    <Suspense fallback={null}>
      <TodoPage />
    </Suspense>
  );
}
