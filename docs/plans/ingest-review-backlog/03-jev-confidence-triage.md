# Show Jev classifier suggestion/confidence in triage and bulk-accept above threshold

Part of epic **#17**. Depends on: slice **#1** (grouping + bulk), slice **#2** (grouped UI),
and the **`feat/jev-ingest-decisions`** branch (commit `0d06fef`), which is **not merged
into `refactor`**.

## Blocking prerequisite

The Jev work exists only on that branch:

- `backend/services/ingest_ai_classifier.py` — one request per source folder, one choice
  question per video file, folder as state.
- `MEDIA_LIBRARY_INGEST_AI_MODE` = `off` (default) | `shadow` | `assist`, and
  `MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE`.
- answers stored at `parsed_info["ai_classification"]`; `shadow` never changes behaviour.
- `POST /api/ingress/queue/ai-classify` (run on demand for an item's folder) and
  `GET /api/ingress/queue/ai-report` (AI labels vs manual corrections).
- failures are logged as an `ai_classification_failed` history event and never block ingest.

**Decision required before this issue is built** (human/maintainer call, not a builder
call): rebase and merge `feat/jev-ingest-decisions` into `refactor`, or drop it and
re-implement the classifier on `refactor`. If nobody decides, this issue stays blocked —
do **not** create a second, parallel classifier, and do not invent a different answer
shape.

## Problem

The heuristic picks the longest file as the main feature and labels everything else a
special feature, so a disc with both a theatrical and an extended cut always needs a
manual fix. The Jev model can already answer that question per file; the triage UI never
shows the answer, so a reviewer still opens every folder to decide.

## Scope

### In scope

1. **Surface the suggestion** in the grouped triage rows: per item, the Jev label
   (`main_feature` / `alternate_version` / `special_feature`), its confidence, and the
   mode that produced it (`shadow` = advisory only). Render an explicit "no AI answer"
   state; `MEDIA_LIBRARY_INGEST_AI_MODE=off` must look like an absent feature, not an error.
2. **Group-level summary**: how many items agree, how many conflict with the heuristic,
   and the minimum confidence in the group — that is the number a reviewer uses to decide
   whether the folder is safe to bulk-accept.
3. **Bulk accept above a confidence threshold**: an "Accept N items ≥ X%" action that
   sends `{ action: "accept", group_key, group_by, status, min_confidence }` to slice #1's
   bulk endpoint. The **floor is enforced server-side** — a browser-supplied id list can
   never accept an item below the configured floor, and
   `MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE` remains the hard lower bound under whatever
   the user picks.
4. **On-demand classify**: a per-group "Re-classify with Jev" button wired to
   `POST /api/ingress/queue/ai-classify`, with a non-blocking progress state (the call
   covers a whole folder and can exceed the client's 15 s timeout — poll or extend the
   timeout for this route only).
5. **Docs**: add the mode/confidence env vars and the two routes to
   `docs/api/endpoints.md` / backend env documentation if the Jev merge does not already
   cover them.

### Out of scope

- Training/prompt tuning, model hosting, or changing the Jev request shape.
- Auto-accepting with no human in the loop (`assist` mode already covers the automated
  path; this issue is about the review queue).
- The `ai-report` accuracy dashboard beyond reusing it if it already answers the question.

## Acceptance criteria

- [ ] Each triage row shows label + confidence, or an explicit "no AI answer" state, with
      no layout shift when the feature is off.
- [ ] `shadow` mode never changes queue status; `assist` behaviour is unchanged from the
      Jev branch.
- [ ] "Accept N items ≥ X%" issues one bulk request and accepts exactly the items whose
      stored confidence is ≥ X.
- [ ] The confidence floor is re-checked on the server; a hand-crafted request with
      below-threshold ids is rejected per item, not silently accepted.
- [ ] `GET /api/ingress/queue/ai-report` numbers and the new UI counters agree for the same
      fixture set.
- [ ] Tests cover: below-floor rejection, missing-answer rendering, and the group summary
      counts; the new tests fail on the base branch.

## Constraints

- Reuse `ingest_ai_classifier.py` and the existing
  `parsed_info["ai_classification"]` shape — no new field names for the same data.
- Manual overrides always win over AI answers (already the rule on the Jev branch; keep it).
- Under ~150 added lines; this slice is mostly plumbing into the UI and the bulk guard.
