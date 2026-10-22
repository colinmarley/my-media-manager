# Ingest triage UI: grouped queue view with per-group accept/ignore

Part of epic **#17**. Depends on: slice **#1** (grouped + bulk endpoints) — the UI must not
fake grouping by pulling the whole flat list.

## Problem

`src/app/admin/_components/IngressAutomationPanel.tsx` renders the ingest queue as one
flat MUI table (`Table` + `TablePagination`) fed by a single `getQueueItems()` fetch, plus
a manual selection mode that already has checkboxes
(`selectionMode`, `selectAllQueueItems`, `handleQueueItemCheck`,
`filterSelectableQueueItemIds`) but replays its actions one HTTP call at a time
(`runQueueActionsSequentially`) and exposes only one bulk action today ("Retry Failed").
At backlog scale that means thousands of rows fetched to the browser, paged client-side,
and triaged one file at a time — while the natural unit of work is the **source folder** a
rip landed in.

Reuse those exported helpers instead of re-implementing selection; the panel is already
~1,600 lines and should not grow.

## Scope

### In scope

1. **New grouped view** — `src/app/admin/_components/IngressTriageGroups.tsx`, mounted
   from the existing Ingress Automation page (`src/app/ingress-automation/page.tsx`) as a
   second tab ("Review by folder") rather than rewriting the flat table in place. The flat
   table stays for single-item work until it is deliberately retired in a later issue.
2. **Service methods** on `src/service/ingress/IngressAutomationService.ts`:
   `getQueueGroups({ groupBy, status, q, limit, offset })` and
   `bulkQueueAction({ action, itemIds } | { action, groupKey, groupBy, status })`,
   matching slice #1's envelope.
3. **Group rows**: folder/title, count, per-status chips, oldest item age, confidence
   range; a checkbox (tri-state: none / some / all items in the group), and
   **Accept** / **Ignore** buttons that call the bulk endpoint once per group.
4. **Expand a group** to its preview items with the existing per-item affordances
   (retry, classify override, manual assign) reusing current handlers.
5. **Virtualization**: render with `@mui/x-data-grid` (already a dependency, v8) using its
   built-in row virtualization, or a windowed list — the requirement is that DOM node count
   stays flat when a group has thousands of items. Do **not** add a new virtualization
   dependency.
6. **Selection semantics**: "select group" selects the group selector on the server side
   (counts beyond the loaded preview are shown as `N more in this folder`), so accepting a
   3,000-file folder does not require the browser to hold 3,000 ids.
7. **Feedback**: batch result summary (`1,940 accepted, 12 failed — show failures`),
   optimistic status that reverts on failure, and a confirmation dialog for anything above
   a preview-only threshold. Ignore is reversible only through the history log, so the
   dialog has to be explicit about that.

### Out of scope

- Backend grouping/bulk SQL (slice #1).
- Jev suggestion column and "accept all above N% confidence" (slice #3) — but leave the
  row shape forward-compatible by keeping a `suggestion` slot in the group item type.
- Retiring the existing flat table or the rest of `IngressAutomationPanel.tsx`.

## Acceptance criteria

- [ ] The grouped view renders from `GET /api/ingress/queue/groups` (paginated server-side);
      no call fetches the entire queue.
- [ ] Selecting a group and pressing Accept/Ignore issues **one** bulk request, and the
      row updates from the response without a full reload.
- [ ] Accepting a group runs the same server path as accepting a single item
      (assignment + organize), so files still land in the right Jellyfin folder.
- [ ] Expanding a group with 1,000+ items keeps rendered rows bounded (virtualized);
      a test asserts the rendered row count stays under a fixed bound for a large fixture.
- [ ] Batch failures are surfaced per item, and a partially failed batch leaves the
      successful rows marked.
- [ ] Works with the existing status filter and search box (`q` is sent to the server,
      not applied client-side).
- [ ] `npx vitest run` passes, with new component tests that fail on `refactor`.

## Suggested touch points

- `src/app/admin/_components/IngressTriageGroups.tsx` (new)
- `src/service/ingress/IngressAutomationService.ts` (new methods + group types)
- `src/app/ingress-automation/page.tsx` (mount the tab)
- `src/app/admin/_components/IngressAutomationPanel.tsx` — export existing helpers if the
  new component needs them; avoid growing this file.
- Tests: `tests/components/IngressTriageGroups.test.tsx` (grouping render, select-group →
  one bulk call, failure surfacing, virtualization bound), following
  `tests/components/IngressAutomationPanel.test.tsx`.

## Constraints

- Under ~350 added lines; the existing panel is already too large to grow further.
- No new npm dependencies.
- Keep the MUI v7 / DataGrid v8 components already in use; no new UI kit.
