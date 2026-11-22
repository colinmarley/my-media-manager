# Content verification

The matcher identifies an ingest file from its name, folder and runtime. Content verification checks that
proposal against the file itself: it samples frames, has a local vision model read the on-screen text, and
for episodes matches about ten minutes of dialogue against the season's TMDB synopses.

It is advisory. The result is stored on the queue item (`parsed_info["content_verification"]`) and shown in
Queue & Review; it never changes a status, a match or a path.

## What it checks

| Check | Evidence | Verdict |
|---|---|---|
| Title | The title on screen, or two cast/crew names TMDB lists | `confirm` |
| Title | A director credit that names none of the title's directors (feature-length and episode files only) | `veto` |
| Episode | Episode title card, then dialogue vs synopses (decider, probability >= 0.7), then guest names | `confirm`, or `veto` with the episode it looks like |
| No match yet | On-screen text searched on TMDB; a hit counts only if its cast or crew is also read in the credits | `suggest` |

`partial` means the series was confirmed but nothing said which episode. `no_evidence` means nothing legible
settled it. File and folder names are never shown to a model.

Feature versus bonus material is not judged: on the benchmark, frames added nothing to the existing
runtime rule.

## Configure

```env
MEDIA_LIBRARY_CONTENT_VERIFY_MODE=shadow          # off | shadow
# MEDIA_LIBRARY_CONTENT_VERIFY_BATCH_SIZE=5        # files per tick
# MEDIA_LIBRARY_CONTENT_VERIFY_INTERVAL_SECONDS=300
# MEDIA_LIBRARY_CONTENT_VERIFY_QUIET_HOURS=01:55-06:45   # loop idle; empty = never
# MEDIA_LIBRARY_CONTENT_VERIFY_TIMEZONE=America/Los_Angeles
# MEDIA_LIBRARY_CONTENT_VERIFY_MIN_CONFIDENCE=0.7
# MEDIA_LIBRARY_CONTENT_VERIFY_WHISPER_URL=        # OpenAI-compatible speech-to-text; empty = subtitles only
# MEDIA_LIBRARY_CONTENT_VERIFY_WHISPER_MODEL=whisper-1
```

It uses services that are already configured:

- **Vision model**: `LOCALAI_URL`, `MEDIA_LIBRARY_LOCALAI_API_KEY`, `MEDIA_LIBRARY_LOCALAI_VISION_MODEL`
  (the cover-scan model, `qwen2.5vl-7b`).
- **Decider** for the dialogue question: `MEDIA_LIBRARY_INGEST_AI_BASE_URL` (see `LOCAL_DECIDER.md`). Without
  one, episodes are checked from title cards and guest names only.
- **TMDB**: `MEDIA_LIBRARY_TMDB_API_KEY`. Without it only the on-screen title can be checked.

In `off` mode nothing runs by itself; the check button on a file in the triage view still works. In `shadow`
mode a background loop also works through `needs_review` items whose file still exists and that have no
result for their current match: films and unknowns first, then episodes. It pauses while ingest is
processing and during the quiet hours.

Dialogue comes from an embedded text subtitle track. Image subtitles (PGS, VobSub) are not read. Episodes
without a text track need the speech-to-text URL; that path was benchmarked with Whisper `small.en` on CPU
but has not been run against a served endpoint.

## API

- `POST /api/ingress/queue/content-verify` `{ "itemId": "..." }`: check one item now, in any mode. One to
  three minutes. `422 CONTENT_VERIFY_FAILED` when the file is missing or the vision model did not answer.
- `GET /api/ingress/queue/content-verify-report`: verdict counts, each split by what happened afterwards:
  `kept` (completed with the match that was judged), `changed` (the match is different now) and `open`. A
  `veto` that was kept is a false alarm; a `confirm` that was changed is a miss.

## Benchmark

`scripts/content-verify-bench/`, 118 library files a person had already accepted (30 films, 58 episodes,
30 extras), `qwen2.5vl-7b` on an RTX 3090, OneJev 9B decider on CPU. Each file was judged against its true
title and against a different title of the same kind.

| Files | Correct title confirmed | Correct title vetoed | Wrong title confirmed | Wrong title vetoed |
|---|---|---|---|---|
| Films (30) | 24 (80%) | 0 | 0 | 2 (7%) |
| Episodes (58) | 48 (83%) | 1 (2%) | 0 | 5 (9%) |
| Extras (30) | 14 (47%) | 0 | 0 | 0 |

A wrong title was never confirmed, so a missing confirmation is the more useful signal; the veto rule is
deliberately narrow (a looser one caught 90% of wrong film titles but vetoed three correct files).

| Episode signal (chance about 1 in 19) | Answered | Correct when answered |
|---|---|---|
| Episode title card | 6/58 | 5/6 |
| Guest names in credits | 12/58 | 11/12 |
| Dialogue from subtitles, probability >= 0.7 | 29/35 | 27/29 (93%) |
| Dialogue from Whisper, probability >= 0.7 | 13/20 | 13/13 |
| Combined | 47/58 (81%) | 44/47 (94%) |

Cost per file: frame and subtitle extraction 15 s median, vision 35 s for 32 frames, dialogue judgement
87 s median on the CPU decider. The vision model fitted on the GPU beside `cardvision-attrs`.

A title in a long on-screen text only counts when it appears as a phrase. The first run on a live ingest
file confirmed "A Diary for Anne Frank" from a notice that merely mentioned Anne Frank; the benchmark had no
such case. The rule costs one film confirmation and one title-card answer in the tables above.

Not measured: identifying files that have no match (the `suggest` path), and Qwen3-VL as the vision model.
On three live files without a match, none produced a suggestion.
