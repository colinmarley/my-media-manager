'use client';

import React from 'react';
import { Tab, Tabs } from '@mui/material';

import { ATTENTION_KINDS } from '@/service/attention/attentionModel';
import type { AttentionKind } from '@/types/attention/Attention.type';
import { DISMISSED_VIEW, type TodoView } from './useTodoFilters';

interface Props {
  value: TodoView;
  counts: Partial<Record<AttentionKind, number>> | null;
  onChange: (next: TodoView) => void;
}

export const todoTabId = (view: TodoView) => `todo-tab-${view}`;
export const todoPanelId = (view: TodoView) => `todo-tabpanel-${view}`;

/** One tab per kind with its count ("Needs renaming (3)"), then Dismissed. */
const TodoKindTabs = ({ value, counts, onChange }: Props) => (
  <Tabs
    value={value}
    onChange={(_event, next: TodoView) => onChange(next)}
    variant="scrollable"
    scrollButtons="auto"
    allowScrollButtonsMobile
    aria-label="To-Do categories"
    sx={{ borderBottom: 1, borderColor: 'divider' }}
  >
    {ATTENTION_KINDS.map((meta) => {
      const count = counts?.[meta.kind];
      const Icon = meta.icon;
      return (
        <Tab
          key={meta.kind}
          value={meta.kind}
          id={todoTabId(meta.kind)}
          aria-controls={todoPanelId(meta.kind)}
          icon={<Icon fontSize="small" />}
          iconPosition="start"
          label={count === undefined ? meta.label : `${meta.label} (${count.toLocaleString()})`}
          sx={{ minHeight: 44, opacity: count === 0 && value !== meta.kind ? 0.6 : undefined }}
        />
      );
    })}
    <Tab value={DISMISSED_VIEW} id={todoTabId(DISMISSED_VIEW)} aria-controls={todoPanelId(DISMISSED_VIEW)} label="Dismissed" sx={{ minHeight: 44 }} />
  </Tabs>
);

export default TodoKindTabs;
