# UI Consolidation Plan (Completed)

## Objective
Consolidate the UI into clear, canonical routes, remove test-only and duplicate pages, and keep admin tools reachable through a single entry point.

## Final Route Set

- `/` -> `src/app/page.tsx`
- `/login` -> `src/app/login/page.tsx`
- `/signup` -> `src/app/signup/page.tsx`
- `/dashboard` -> `src/app/dashboard/page.tsx`
- `/dashboard/media` -> `src/app/dashboard/media/page.tsx`
- `/dashboard/media/library` -> `src/app/dashboard/media/library/page.tsx`
- `/admin` -> `src/app/admin/page.tsx`
- `/admin/library` -> `src/app/admin/library/page.tsx`

## Completed Changes

- Removed AI chat route and styles:
  - `src/app/project/aichat/page.tsx`
  - `src/app/project/aichat/_styles/aichat.module.css`
- Replaced dashboard chat UI with a dashboard hub:
  - `src/app/dashboard/page.tsx`
- Removed thin wrapper routes:
  - `src/app/admin/imageManager/page.tsx`
  - `src/app/admin/libraryBrowser/page.tsx`
  - `src/app/admin/libraryBrowser/assignment/page.tsx`
- Removed test-only and empty routes:
  - `src/app/dashboard/media/info/page.tsx`
  - `src/app/project/media/page.tsx`
- Updated navigation to canonical admin deep-link:
  - Header now links to `/admin?view=LibraryBrowser`
  - Admin layout supports `?view=` tab selection
  - Library page “Open Library Browser” now uses `/admin?view=LibraryBrowser`

## Outcome

- The app now has one canonical admin entry route (`/admin`) with tab-based tooling.
- Duplicate and non-product test surfaces are removed from active routes.
- Route ownership and user navigation paths are clearer and easier to maintain.
