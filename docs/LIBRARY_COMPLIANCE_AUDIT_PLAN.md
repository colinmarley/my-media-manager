# Library Compliance Audit Plan

Date: 2026-05-14
Status: Proposed
Owner: Media Manager

## 1. Objective

Add a non-destructive audit feature that scans the existing media library and flags files that are out of place or incorrectly named for Jellyfin conventions.

The feature must:
- Detect potential issues (duplicates, misplaced extras, naming mismatches, structural mismatches)
- Never automatically move files during scan
- Mark findings for review
- Provide a clear review UI for all flagged files/movies
- Let users manually apply a proposed fix or choose a custom fix
- Keep an audit trail of decisions and actions

## 2. Existing Foundations To Reuse

Current system components already support most of the plumbing:

- Async scan lifecycle and progress tracking:
  - backend/services/library_scanner.py
  - backend/api/library_operations.py
- Existing naming/classification behavior used for ingress organization:
  - docs/JELLYFIN_MEDIA_ORGANIZATION.md
  - docs/INGRESS_ASSIGNMENT_REFERENCE.md
- Existing review-queue interaction patterns:
  - src/app/admin/_components/IngressAutomationPanel.tsx
  - src/service/ingress/IngressAutomationService.ts
- Safe file operations endpoints for manual actions:
  - backend/api/file_operations.py

Implementation should avoid creating a second naming system and instead reuse shared naming/classification logic.

## 3. Feature Scope

### 3.1 Phase 1 (Movies)

- Audit movie folders and files for Jellyfin compliance
- Detect duplicate main-feature candidates
- Detect extras/special features that are misplaced or misnamed
- Detect naming convention mismatches for folder/file pairs
- Detect obvious structure mismatches
- Provide proposed fixes, but do not apply automatically

### 3.2 Phase 2 (Shows)

- Audit show/season/episode structure and naming
- Validate season folder format and episode naming
- Detect specials in wrong location
- Detect ambiguous episode files that need manual review

## 4. Detection Rules

### 4.1 Duplicate Main Feature Candidates

Flag when multiple files in a movie folder look like main feature copies and are not clearly marked as alternate versions.

Signals:
- Similar long durations
- Similar file sizes
- Names that look like primary title but differ by source tags only

### 4.2 Misplaced Extras / Special Features

Flag extras that appear in unexpected location or do not follow naming expectation for special features.

Examples:
- Bonus feature in same naming slot as main feature
- Extras not under preferred extras/special handling convention

### 4.3 Naming Convention Mismatch

Flag folder/file names that do not match expected Jellyfin pattern for organized content.

Examples:
- Movie folder name does not align with expected title/year token style
- Main file name does not align with folder identity
- Missing expected identifier token when metadata exists

### 4.4 Structural Mismatch

Flag layout issues that imply wrong placement.

Examples:
- Extra nested folder levels for a single movie
- Folder identity and file identity disagree
- Main feature appears outside expected folder path

### 4.5 Confidence and Severity

Each finding includes:
- confidence score (0-100)
- severity: critical, high, medium, low
- rationale text

Low-confidence findings should default to explicit manual review state.

## 5. Rule Engine Design

Create a compliance service:
- backend/services/library_compliance_service.py

Pipeline:
1. Enumerate files/folders using scanner utilities
2. Infer observed role for each file (main_feature, alternate_version, special_feature, unknown)
3. Compute expected role/path/name based on shared naming rules
4. Compare observed vs expected
5. Emit findings with proposed operations and rationale

Outputs:
- findings list
- scan summary counters
- per-rule statistics

## 6. Data Model (PostgreSQL)

Add dedicated compliance tables.

### 6.1 compliance_scans

Columns:
- id
- library_path
- status (running, completed, failed, cancelled)
- started_at
- completed_at
- triggered_by
- summary_json
- created_at, updated_at

### 6.2 compliance_findings

Columns:
- id
- scan_id (FK)
- media_type
- media_id (nullable)
- folder_path
- file_path (nullable)
- issue_type
- severity
- confidence
- current_state_json
- expected_state_json
- rationale
- status (open, ignored, snoozed, resolved, needs_manual_review)
- created_at, updated_at

### 6.3 compliance_actions

Columns:
- id
- finding_id (FK)
- action_type (rename, move, create_folder, noop)
- source_path
- target_path
- payload_json
- selected (bool)
- created_at

### 6.4 compliance_review_events

Columns:
- id
- finding_id (FK)
- event_type (accepted, rejected, ignored, snoozed, reopened, applied, failed)
- actor
- note
- event_payload_json
- created_at

### 6.5 Indexes

- compliance_findings(status)
- compliance_findings(issue_type)
- compliance_findings(severity)
- compliance_findings(scan_id)
- compliance_findings(media_id)
- compliance_scans(status)

## 7. API Design

Add router:
- backend/api/library_compliance.py

### 7.1 Scan Lifecycle

- POST /api/library/compliance/scan
  - Start scan
  - Body options: library paths, media type filter, issue types

- GET /api/library/compliance/scan/status/{scan_id}
  - Progress and summary

- POST /api/library/compliance/scan/{scan_id}/cancel
  - Cancel running scan

### 7.2 Findings

- GET /api/library/compliance/findings
  - Filter by status, severity, issue_type, library_path, media_type, date
  - Pagination + sorting

- GET /api/library/compliance/findings/{finding_id}
  - Full details and proposed actions

- PATCH /api/library/compliance/findings/{finding_id}
  - Update status (open, ignored, snoozed, resolved, needs_manual_review)

### 7.3 Fix Preview + Apply

- POST /api/library/compliance/findings/{finding_id}/preview
  - Dry-run validation of selected actions
  - Detect path collisions and permissions issues

- POST /api/library/compliance/findings/{finding_id}/apply
  - Apply selected action(s) explicitly

- POST /api/library/compliance/bulk/apply
  - Apply selected findings in batch

- POST /api/library/compliance/bulk/status
  - Bulk ignore, snooze, reopen

### 7.4 Summary

- GET /api/library/compliance/summary
  - Dashboard counters and trends

## 8. UI/UX Plan

Add page:
- src/app/admin/library/compliance/page.tsx

### 8.1 Top Summary

Cards:
- Open findings
- Critical/high findings
- Duplicate-main findings
- Misplaced-extras findings
- Naming mismatches

### 8.2 Findings Table

Columns:
- status
- severity
- issue type
- title/media
- current path
- proposed target
- confidence
- updated at

Capabilities:
- Search/filter/sort
- Multi-select
- Bulk actions

### 8.3 Finding Detail Panel

Show:
- Why it was flagged
- Observed state vs expected state
- Proposed action list
- Validation notes

Actions:
- Preview fix
- Apply selected fix
- Mark ignored
- Snooze
- Mark resolved
- Open custom fix dialog

### 8.4 Manual Fix UX

User flow:
1. Preview proposed fix
2. Confirm apply
3. Receive per-operation results
4. Finding status updates + event logged

If preview fails:
- Show conflict details
- Offer custom target rename/path
- Allow mark as needs_manual_review

## 9. Safety Requirements

- Scan does not modify files
- Fix actions require explicit user apply
- All file changes run through existing path-security checks
- No destructive overwrite by default
- Collision handling required before apply
- Full event history for auditability

## 10. Reuse Strategy

Avoid duplicated logic by sharing code from current organization rules:
- role inference and naming expectations should be centralized and imported by both ingress organization and compliance audit
- compliance engine should not hardcode separate naming behavior

## 11. Rollout Plan

### Phase A: Backend MVP (1-2 weeks)

- Data model + migrations
- Compliance scan service (movies only)
- Findings APIs (read-only)

### Phase B: Review UI (1 week)

- Findings list/detail UI
- Status actions: ignore/snooze/reopen/resolve

### Phase C: Apply Flow (1 week)

- Preview endpoint
- Single and bulk apply endpoints
- UI apply workflow and result reporting

### Phase D: TV Rules (1-2 weeks)

- Show/season/episode validation
- Specials placement checks

### Phase E: Incremental + Scheduled Scans

- Scan only changed folders
- Nightly/weekly scheduled compliance run

## 12. Test Plan

### 12.1 Unit Tests

- Rule detection per issue type
- Confidence and severity assignment
- Proposed action generation

### 12.2 Integration Tests

- Scan lifecycle endpoints
- Findings filtering and status transitions
- Preview/apply behavior and collision handling

### 12.3 UI Tests

- Scan trigger + progress display
- Findings table and detail interactions
- Single and bulk action workflows

### 12.4 Safety Regression Tests

- Verify scans perform no file mutations
- Verify apply requires explicit request
- Verify no silent overwrite on conflict

## 13. Success Metrics

- Precision: >= 90% of high-severity findings are accepted as valid by users
- Time-to-resolution: median <= 4 interactions per resolved finding
- Backlog trend: open critical findings decline over time
- Safety: zero unintended file moves

## 14. Product Decisions To Finalize

Before implementation begins, lock these:

1. Canonical policy for movie extras placement and naming
2. Duplicate-main handling default (which file is preferred main)
3. Confidence threshold for bulk-apply eligibility
4. Initial operation mode: manual scans only vs scheduled scans enabled

## 15. Suggested First Tickets

1. DB migration for compliance tables
2. Backend compliance scan skeleton + scan status endpoints
3. Movie duplicate-main detection rule
4. Naming mismatch detection rule
5. Findings list API with filters
6. Admin compliance page with findings table
7. Finding detail panel + preview endpoint
8. Apply action endpoint + event logging
9. Bulk status and bulk apply endpoints
10. TV rule expansion
