# Naming & Folder Conventions — Full Pipeline

This is the single reference for how a file's name is decided from the moment
it's ripped/digitized through to its final path in the Jellyfin library. It
spans two repos: `disc-ripper-service` (rips) and `my-media-manager` (ingest,
extras, and the catalog).

For the base movie/show ingest naming rules (folder structure, `[imdbid-...]`
tagging, filename collision handling), see
[`JELLYFIN_MEDIA_ORGANIZATION.md`](./JELLYFIN_MEDIA_ORGANIZATION.md) — this
document doesn't repeat those, it covers what that one doesn't: extras
categorization and the disc-ripper-service side of naming.

## Pipeline Overview

```
disc-ripper-service                    my-media-manager
────────────────────                   ─────────────────
_build_dest_name()          ──────►    ingest watcher detects file
(job_manager.py)                       (FileWatcherService)
        │                                       │
        │ writes to shared                      ▼
        │ /ark/media/jellyfin/ingest    IngressQueueService
        │ bind mount                    parses filename, matches
        │                               TMDB/OMDB, scores confidence
        ▼                                       │
  filename carries                              ▼
  the ONLY signal              AssignmentOrchestrator.auto_assign()
  disc-ripper-service          creates MediaAssignment + MediaFile rows
  can send —                            │
  no HTTP push exists                   ▼
  for content type          FileOrganizationService.organize_assignment()
                             moves file into Jellyfin folder structure
```

There is no API call from disc-ripper-service to my-media-manager's ingest
pipeline for naming/classification — delivery is filesystem-only. The
**filename itself** is the only channel available to communicate a title's
role (main feature, trailer, deleted scene, etc.) across that boundary. This
is why the suffix convention below has to match exactly on both sides.

## disc-ripper-service naming (`backend/services/job_manager.py::_build_dest_name`)

| Case | Output |
|---|---|
| Movie, single title | `Title (Year).mkv` |
| Movie, multiple titles (no content type set) | `Title (Year) - Version 2.mkv`, `- Version 3.mkv`, ... |
| Show, episode | `Title S01E03.mkv` or `Title S01E03 - Episode Name.mkv` (from `episode_map`, user-entered or TMDB-assigned) |
| Show, no map entry | `Title S{season}E{i+1}.mkv` (sequential fallback) |
| **Any title with a `content_type` set** | `Title (Year)-{suffix}.mkv`, e.g. `Title (Year)-trailer.mkv` |
| Duplicate content types on one disc | `Title (Year) 2-{suffix}.mkv`, `Title (Year) 3-{suffix}.mkv`, ... (number goes *before* the suffix so the suffix stays at the end of the filename — see below) |

`content_type` comes from `StartJobRequest.title_content_types`
(`{title_idx: category_slug}`), set per-title in the rip-configuration UI's
`ExtrasTypeSelector`. It always takes priority over the movie/episode naming
above — a title tagged as a trailer never gets `- Version N` naming, even on
a multi-title disc.

Folder placement: `_ingest_folder_name()` builds
`{Title} ({Year}) [imdbid-ttXXXXXXX]` (movies) or the same without the
episode suffix, with `Season {NN}` appended for shows. Extras land in the
**same folder as the main feature** at delivery time — my-media-manager's
extras classifier is what sorts them into a subfolder later (see below).

## Extras Taxonomy (`my-media-manager/backend/services/extras_taxonomy.py`)

Single source of truth for both repos' extras handling — this module is the
one place the category list, folder names, and filename-suffix tokens are
defined. If you add a category, update the `CONTENT_TYPE_SUFFIX` dict in
disc-ripper-service's `job_manager.py` to match.

| Category slug | On-disk Jellyfin folder | Filename suffix token |
|---|---|---|
| `behind_the_scenes` | `behind the scenes` | `-behindthescenes` |
| `deleted_scene` | `deleted scenes` | `-deletedscene` |
| `interview` | `interviews` | `-interview` |
| `featurette` | `featurettes` | `-featurette` |
| `trailer` | `trailers` | `-trailer` |
| `scene` | `scenes` | `-scene` |
| `sample` | `samples` | `-sample` |
| `short` | `shorts` | `-short` |
| `clip` | `clips` | `-clip` |
| `blooper` | `bloopers` | `-blooper` |
| `other` | `other` | `-other` |

The suffix regex (`classify_extra_from_stem` in `extras_taxonomy.py`) matches
the token at the **very end** of the filename stem, preceded by a space,
dot, underscore, or dash. This is why disc-ripper-service's numbering scheme
puts the disambiguating number *before* the dash-suffix
(`Title (Year) 2-trailer.mkv`, not `Title (Year)-trailer2.mkv`) — the token
has to stay exactly at the end to auto-classify.

### Where classification happens

1. **At rip time** (disc-ripper-service): the user explicitly picks a
   category per title via `ExtrasTypeSelector`. This is the most reliable
   source — `source="inferred-from-ripper"` once it reaches the review queue.
2. **At ingest time** (`jellyfin_movie_organizer.py` /
   `jellyfin_show_organizer.py`, via the shared `classify_extra_from_stem`):
   filename-suffix pattern matching, same table as above.
3. **Manual review** (`/admin` → Extras Review tab, `api/extras.py`): every
   auto-suggested category (from either path above) requires human
   confirmation before the file is actually moved into its extras subfolder
   — see `AssignmentExtraFile.confirmed` and
   `file_organization_service.py::_get_source_files`, which only includes
   confirmed extras when organizing an assignment.

**Known gap:** ingest-time auto-detection currently only classifies files
during the *manual* Jellyfin-reorganize pass
(`jellyfin_movie_organizer.py`/`jellyfin_show_organizer.py`), not
automatically as part of the live ingress queue processing
(`ingress_queue_service.py`). A file ripped without an explicit content type
still lands as a generic `Special Feature N` at ingest time and needs a
manual reorganize pass to get properly classified. Wiring automatic
classification into the ingress queue itself is tracked separately (see the
repo's task list / `AssignmentExtraFile` follow-up work) — it's a real
architecture change to the live pipeline, not a naming-convention fix, which
is why it's called out here rather than silently assumed to work.

## Physical Media Linking

A rip or tape-ingest session can be linked to a catalog `Disc`/`Tape` record
(`/api/catalog/discs*`, `/api/catalog/tapes*`) — this is **not** encoded in
the filename at all. disc-ripper-service pushes the link via
`POST /api/catalog/link-source` (see `services/catalog_client.py`) right
after delivery, since that's the only point it has both the file paths and
the `catalog_disc_id` at the same time. If that call fails (service
unreachable), the rip still completes and ingests normally — it just won't
show up under the disc's "Files" list in `/dashboard/physical-media` until
manually linked.
