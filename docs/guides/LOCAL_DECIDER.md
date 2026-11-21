# Local ingest decider (self-hosted Jev)

The ingest classifier (`backend/services/ingest_ai_classifier.py`) labels every video in a disc folder as
**main feature**, **alternate version** or **special feature**. It speaks TypeSafe's System One API
(`POST {base_url}/systemone`), so it can use hosted Jev or any compatible server. This guide covers the
self-hosted one: **OneJev 1.5 9B** (Apache 2.0, `OmniJev/OneJev`) on llama.cpp, CPU only.

## Configure the backend

```env
MEDIA_LIBRARY_INGEST_AI_MODE=shadow                       # off | shadow | assist
MEDIA_LIBRARY_INGEST_AI_BASE_URL=http://<decider-host>:8130/v1
MEDIA_LIBRARY_INGEST_AI_MODEL=jev-latest                  # qev ignores it; keep it for hosted Jev
# MEDIA_LIBRARY_INGEST_AI_MIN_CONFIDENCE=0.7
# MEDIA_LIBRARY_INGEST_AI_TIMEOUT_SECONDS=150
```

A base URL that is not `api.typesafe.ai` needs no API key. With a base URL set, the Queue & Review
**Re-classify with Jev** button works in every mode, including `off`; the mode only decides whether ingest
calls the decider by itself. Series folders are never sent (episodes are numbered from their file names).

`shadow` is the recommended mode: the answers are stored on each queue item and shown in review, and
`GET /api/ingress/queue/ai-report` counts how often they matched a manual correction. The benchmark below
found no case where `assist` would have changed a label for the better, so turn it on only if the report
shows otherwise on real ingests.

## Run the decider

```bash
# Weights and tokenizer, once (~9.5 GB). The GGUF is mradermacher/OneJev1.5-9B-GGUF Q8_0; the tokenizer
# files come from OmniJev/OneJev1.5-9B (no calibration.json is published for 9B).
mkdir -p /data/mmm-decider/models /data/mmm-decider/tokenizer
huggingface-cli download mradermacher/OneJev1.5-9B-GGUF OneJev1.5-9B.Q8_0.gguf --local-dir /data/mmm-decider/models
huggingface-cli download OmniJev/OneJev1.5-9B --include '*.json' '*.jinja' --local-dir /data/mmm-decider/tokenizer/OneJev1.5-9B

cd deploy/decider && cp .env.example .env
docker compose up -d --build
curl -s localhost:8130/health   # {"status":"ok","model":"onejev-1.5-9b-q8",...}
```

- **CPU on purpose.** A shared GPU is usually taken (other model servers, leases), and ingest
  classification runs in the background. With 12 threads one disc folder takes about **12 s at p50 and
  up to ~2 min** for a 40-file box set. The 9B Q8 model needs ~10 GB of RAM.
- The first file of a folder classifies the whole folder; its siblings reuse that answer unless the
  folder gains files. Failures (decider down, timeout) are logged as `ai_classification_failed` and never
  block ingest.
- Same answers on GPU: running the container with `--gpus all` gives identical labels at ~0.8 s per folder.

## Benchmark (2026-11-21)

**Eval set.** 364 movies from the library with known file roles (364 mains, 42 alternate cuts, 1,512
extras after fixing labels; see below; folders capped at 40 files). Each movie's files form one "disc folder". Two variants:

- **anonymized**: every file is `title_tNN.mkv` in shuffled order, so only runtimes, sizes and the film's
  metadata are informative. This is what a MakeMKV rip looks like.
- **named**: extras and cuts keep their original ingest names ("Theatrical Trailer.mkv", "Blade-Runner D1
  (1982).mkv"); the main gets a MakeMKV disc-title name.

The request is exactly the classifier's (one state per folder, one choice question per file).
"Feature vs extra" counts a file right when it lands on the correct side of film-or-bonus; "multi-cut
discs" is the share of the 39 folders holding several cuts where every file is right.

| Model (anonymized names) | Feature vs extra | Alternate cuts found | Multi-cut discs right | Right when conf ≥ 0.7 (share answered) | Latency / folder |
|---|---|---|---|---|---|
| Old rule (cuts only become versions when the main is already in the library) | 96.9% | 41% | 0% | – | – |
| **New rule** (≥85% of the main's runtime = alternate version, always) | **97.7%** | 93% | **87%** | – | – |
| OneJev 1.5 0.8B Q8, CPU | 50.4% | 98% | 10% | 97% (10%) | 1.8 s |
| Strands Decider 2B, GPU | 51.7% | 100% | 49% | 96% (11%) | 0.15 s |
| **OneJev 1.5 9B Q8**, GPU | 93.6% | 100% | 67% | **99.3% (35%)** | 0.8 s (12 s on CPU) |
| OneJev 1.5 9B + "under 40% of the longest file = special" rule | 97.1% | 100% | 82% | 99.7% (91%) | |
| *Assist mode simulation* (9B answer when conf ≥ 0.7, else new rule) | 97.7% | 93% | 87% | | |

With original names the 9B model is confident more often (55% of files at ≥ 0.7, 99.7% right), and 9B +
the 40% rule reaches 90% of multi-cut discs (vs 87% for the new rule) but 97.0% feature-vs-extra (vs 97.7%).
Assist mode again matched the new rule exactly: **in both variants a confident 9B answer never disagreed
with the new rule in a way that fixed it.** The remaining errors are long bonus documentaries (≥ 85% of the
film's runtime) that neither runtimes nor these models tell apart from a second cut.

Not benchmarked: Clef-flash 9B and OneJev 27B (both need the whole 24 GB GPU) and hosted Jev (no key).

**Label fixes.** The library marks some bonus clips that sit in a movie folder's root as
`media_files.role = 'version'` (Tommy Boy: 37, Constantine: 15, Tombstone: 12, ...). A "version" under 70%
of its main's runtime is scored as an extra.

### Re-run it

```bash
# 1. Export the groups (read-only), on the database host:
docker exec -i media-manager-db sh -c 'psql -U "$POSTGRES_USER" -d media_manager -At' \
  < scripts/decider-bench/export_groups.sql > groups.jsonl
# 2. Baselines, then any System One server:
python scripts/decider-bench/bench.py --groups groups.jsonl --provider heuristic85 --name heuristic85 --out results/heuristic85.jsonl
python scripts/decider-bench/bench.py --groups groups.jsonl --provider systemone \
  --url http://<decider-host>:8130/v1 --name onejev-9b --out results/onejev-9b.jsonl
python scripts/decider-bench/bench.py --report 'results/*.jsonl'
DIR=results python scripts/decider-bench/assist_sim.py onejev-9b
```
