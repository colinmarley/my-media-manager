# Content-Based Identification of Video Files: Research and Recommendation

Date: 2026-11-08
Question: smart TVs identify what is on screen by fingerprinting frames/audio and matching against a reference database (Automatic Content Recognition, ACR). Can the same be done for the files in `/ark/media/jellyfin/ingest` so the organizer knows *what a video is* without trusting its filename?

Companion to [INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md](./INGEST_AUTOMATION_ANALYSIS_AND_REDESIGN.md); the "content-derived evidence" extractor in §6.4 of that document is specified here.

---

## 1. Short answer

- **The TV approach cannot be reproduced at home.** The fingerprinting algorithms are public and have open-source implementations. The thing that makes ACR work is a licensed reference database of every movie and episode, built from catalog and broadcast ingest. Gracenote (Nielsen), Samba TV, Vizio Inscape, Alphonso and Audible Magic own such databases and sell access only under enterprise contracts. No public, free, or self-serve API identifies a movie or episode from a fingerprint of the content itself.
- **ACRCloud looks like the exception but is not.** Its self-serve API identifies *music* and *live TV channels its customers ingest*; its "movie/video" products only recognize content you upload yourself.
- **What does work for a self-hosted setup** is a layered approach that uses content to *confirm or disambiguate* candidates produced by cheap signals:
  1. Speech-to-text (Whisper, local GPU) on a few minutes of dialogue, matched against per-episode or per-title subtitle text from OpenSubtitles. Several open-source projects do exactly this for TV episodes. This is the realistic "what episode is this" solution for the disc rips that dominate the current backlog.
  2. Deterministic file signals (MKV segment title written by MakeMKV, duration vs. TMDB runtime, chapter count, disc label) to build the candidate list.
  3. End-credit / title-card OCR with a local vision model (LocalAI already runs `qwen2.5vl-7b` for the cover-scan feature) to recover a movie title and director/cast names when the label is useless.
  4. A private perceptual fingerprint index (audio landmarks via Olaf/audfprint, video via ffmpeg's MPEG-7 signature filter) of files already organized, so a re-rip or duplicate is recognized as content the library already has.

---

## 2. How smart-TV ACR works

The TV periodically captures the screen and/or audio, reduces each capture to a compact perceptual fingerprint (downscaled luma features of frames, or spectral landmarks for audio), batches them, and uploads to the vendor, which matches against a reference library of linear feeds, ads, streaming catalogs and films. A 2024 measurement study found LG captures frames every 10 ms and uploads about every 15 s; Samsung captures every 500 ms and uploads about once a minute. ACR also fires on HDMI inputs, so it works on any source.

Sources: [arXiv 2409.06203, "Watching TV with the Second-Party"](https://arxiv.org/html/2409.06203v1) · [UC Davis summary](https://www.ucdavis.edu/news/your-smart-tv-watching-what-you-watch) · [Wikipedia: Automatic content recognition](https://en.wikipedia.org/wiki/Automatic_content_recognition) · [ACR patent US11683560](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11683560)

---

## 3. Reference databases and APIs with a film/TV catalog

| Service | Catalog has movies/TV? | Usable by an individual? | Notes |
|---|---|---|---|
| Gracenote (Nielsen) Video ACR | Yes | No. Enterprise licensing via sales; dev portal exposes only metadata APIs. | [devportal.gracenote.com](https://devportal.gracenote.com/) |
| ACRCloud | **No built-in movie/TV catalog.** Music + customer-ingested live channels + "custom content" you upload. | Yes (self-serve, 14-day trial, usage billing behind login). | `POST /v1/identify` with an audio sample ≤ 15 s. Only useful as a hosted version of a *private* index. [Docs](https://docs.acrcloud.com/tutorials/recognize-tv-channels-and-custom-content) |
| Audible Magic | Yes (rightsholder-supplied) | No; licensed to platforms, access gated per retailer. | [Developers](https://support.audiblemagic.com/welcome-developers) |
| YouTube Content ID | Yes | No; approved rightsholders only, no lookup API. | [Eligibility](https://support.google.com/youtube/answer/1311402) |
| Shazam | Music only | n/a | No video endpoint |
| AcoustID / Chromaprint | Music only | Yes, free | Video identification discussed on the mailing list, never built. [Thread](https://groups.google.com/g/acoustid/c/C0QPEqkkpxk/m/J1cKRPSxAwAJ) |
| Consumer "Shazam for movies" apps (Clypse, WMIT, ClipFix) | Tiny curated catalogs or vision-LLM guessing | Phone apps, no API | Not a dependency to build on |
| Open datasets | None found that function as an identification database | – | – |

Unverified: ACRCloud's per-request price (login-walled); whether Gracenote has any tier below enterprise (nothing suggests it).

---

## 4. Open-source fingerprinting that runs locally

None ships a movie/TV reference database. All are suitable for a **private index** of content already labeled.

**Audio (landmark fingerprints; can find a reference *inside* a longer query, which matters for multi-episode disc titles)**

| Tool | Notes |
|---|---|
| [Olaf](https://github.com/JorenSix/Olaf) (C, AGPL) | LMDB store, reports reference start/stop and query offset, dedup mode. Author indexed ~100k tracks into ~15 GB; queries ~80× real time. Docker images. Best fit. |
| [audfprint](https://github.com/dpwe/audfprint) (Python, MIT) | Same idea, pure Python, pickled DB, `--find-time-range` gives the matched span. Low activity but mature. |
| [Dejavu](https://github.com/worldveil/dejavu) (Python) | Postgres/MySQL-backed; storage heavy. |
| Chromaprint (`fpcalc`) | Whole-file chroma fingerprint; used by Jellyfin's [Intro Skipper](https://github.com/intro-skipper/intro-skipper) to find shared intros across a season. Good for "which show", not "which episode". |

**Video (whole-file near-duplicate detection)**

| Tool | Notes |
|---|---|
| ffmpeg `signature` filter (MPEG-7 Video Signature, GPL build) | `ffmpeg -i a.mkv -i b.mkv -filter_complex "[0:v][1:v]signature=nb_inputs=2:detectmode=full:format=xml:filename=sig%d.xml" -map :v -f null -` reports full/partial matches; robust to re-encode and resolution changes. No built-in index; store the `.bin` per file and compare pairwise. [Docs](https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/signature.html) |
| [ISCC](https://github.com/iscc/iscc-sdk) (ISO 24138:2024) | Similarity-preserving content code per file, compared by Hamming distance. Good as a compact "content id" column. |
| [TMK+PDQF](https://github.com/facebook/ThreatExchange/tree/main/tmk) (Meta, C++) | Fixed-length video descriptor, cosine scoring, FAISS variant. Whole-video only; weak on clips. |
| videohash / pHash | Quick one-hash dedupe; cannot detect containment. |

---

## 5. Approximating "what is this video" without a global database

### 5a. Speech-to-text + subtitle text match (strongest option)

**How:** extract 3–5 minutes of audio after the intro, transcribe with faster-whisper on the GPU box, fetch candidate subtitles (per episode of the suspected season, or per candidate movie) from OpenSubtitles, and score transcript vs. subtitle text locally (token-F1, Levenshtein, or sentence embeddings). Dialogue is near-unique per episode, so within a known season this is very accurate.

**Existing implementations:**

| Project | Approach |
|---|---|
| [mkv-episode-matcher](https://github.com/Jsakkos/mkv-episode-matcher) (Python, MIT) | faster-whisper on segments, downloads whole-season subs from OpenSubtitles, TMDB for titles, multi-segment confidence scoring. Author flags the OpenSubtitles quota as the main pain. |
| [plexUtils/autoTagger_sub](https://github.com/sploders101/plexUtils) (Node) | Extracted SRT vs. OpenSubtitles per-episode subs, Levenshtein. Its video-thumbnail variant is marked "not recommended, too unpredictable". |
| [DialogDetective](https://docs.rs/crate/dialog_detective/latest/source/README.md) (Rust, MIT) | whisper.cpp transcript, LLM picks the episode from TVMaze's list using world knowledge. No subtitle ground truth; hallucination-prone for obscure shows. |
| [TVIdentify](https://github.com/ram-nat/tvidentify) (Python, MIT) | OCRs the disc's PGS/VobSub subtitle track (Tesseract or a vision model via Ollama) and asks a cloud LLM. Note the idea: **disc rips usually carry subtitle tracks, so OCR of embedded subtitles can replace Whisper entirely** and is language-exact. |
| [submatch](https://pypi.org/project/submatch) (Python, MIT) | Whisper on short segments vs. a candidate `.srt`; token-F1 and multilingual embeddings. Ideal as the verifier stage. |
| [ffsubsync](https://github.com/smacke/ffsubsync/) (Python) | Voice-activity cross-correlation against a candidate `.srt`; a wrong-episode subtitle fails to align. Cheap pre-filter that needs no transcription. |

**OpenSubtitles.com REST API facts** ([help](https://opensubtitles.tawk.help/article/about-the-api), [quotas](https://blog.opensubtitles.com/?p=2292)):
- API key required (free "API Consumer" in an account). `GET /subtitles` accepts `imdb_id`, `tmdb_id`, `parent_imdb_id` + `season_number` + `episode_number`, `query`, `languages`, and `moviehash`; `POST /download` by `file_id`.
- **No full-text or quote search.** You must know the candidate titles first and download their subtitles.
- Download quota: anonymous 5/day, free account 20/day, VIP (~$3/month) ~1,000/day. A 24-episode season exceeds the free tier, so cache subtitles per show on the NAS.
- `moviehash` is a 64-bit sum of file size + first and last 64 KiB. It only matches byte-identical release files, never a MakeMKV rip. Useful as a free bonus signal for scene releases (`Nightbitch.2024.1080p.WEB.h264-ETHEL`), useless for disc rips.

**Cost:** $0 locally, optionally ~$3/month for OpenSubtitles VIP. **Offline:** transcription yes; subtitle fetch once per title. **Accuracy:** no published benchmarks; anecdotal reports are strong. Needs a candidate set (the show, or a shortlist of movies), which the deterministic signals below provide.

### 5b. Deterministic file signals (candidate generators)

- **MKV segment title.** MakeMKV writes the disc/title name into the Matroska Segment Title (`ffprobe -show_format` → `tags.title`). On Blu-ray this comes from `BDMV/META/DL/bdmt_eng.xml` and is usually the disc name; on DVD it is DVD-TEXT or the volume label, which is often `DVD_VIDEO`, `SEASON_1_DISC_2` or a SKU. Never trustworthy alone, frequently helpful. ([MakeMKV forum](https://forum.makemkv.com/forum/viewtopic.php?p=107665))
- **Duration vs. TMDB runtime.** TMDB movie and episode runtimes are integer minutes, often null, sometimes wrong, and uniform across sitcom seasons. Use as a filter (reject candidates off by more than ~2 min / 5%), not an identifier. [BluSlate](https://github.com/JohnPostlethwait/BluSlate/wiki) does runtime + disc-order matching and its author calls it "highly imperfect": fine for *Firefly*, bad for *Seinfeld*.
- **Disc identity.** [Automatic Ripping Machine](https://raw.githubusercontent.com/automatic-ripping-machine/automatic-ripping-machine/main/arm/ripper/identify.py) identifies DVDs by CRC64 (`pydvdid`) against a community database, then falls back to TMDB/OMDb search on the cleaned label. This belongs in `disc-ripper-service`, which has the disc, not in the organizer, which only has the files.
- **Chapter count / audio layout.** No public per-release database with an API (DVDCompare.net is volunteer HTML). Disambiguator only.

### 5c. OCR / vision model on title cards and credits

No ready-made project does this for identification; the components all exist locally (ffmpeg frame sampling, Tesseract/PaddleOCR, or `qwen2.5vl-7b` through the LocalAI instance this backend already calls for cover scans). Title cards are stylized and sometimes only at the end; **end credits are the richer signal**: "Directed by", cast lists and the production company give a set of names that TMDB's credits endpoints can confirm. Strong for movies with unusable labels, weak for *which episode*. Unbenchmarked.

### 5d. Private fingerprint index (dedupe and re-rip detection)

Fingerprint every organized file once (Olaf for audio, ffmpeg `signature` for video) and store the result keyed by `media_files.id`. New arrivals are queried against it before any metadata search: a hit means "this is content the library already has", including partial hits when a disc title contains several episodes. Identifies nothing new, but turns the 60-odd `Title D1`/`Title D2` folders and re-rips in the backlog into certain matches.

---

## 6. Existing organizers and what they use

| Project | Signals | Content-based? |
|---|---|---|
| FileBot | Name/folder parsing, OpenSubtitles moviehash (byte-level), TMDB/TheTVDB/AniDB, xattr memory of original names | Hash only |
| tinyMediaManager | Name cleaning, `[imdbid-…]` tags, existing NFO, scrapers with score threshold | No |
| Radarr / Sonarr | Release-name parsing | No |
| Plex / Jellyfin / Emby | Name tokens, folders, NFO, provider ids; Plex fingerprints music only | No |
| mnamer, guessit, subliminal | Filename parsing (+ moviehash refiner in subliminal) | Hash only |
| Automatic Ripping Machine | DVD CRC64 community DB, disc label → TMDB/OMDb | Disc-level |
| mkv-episode-matcher, plexUtils, DialogDetective, TVIdentify, BluSlate | STT / subtitle OCR / runtime | **Yes** |

Nothing mainstream identifies by perceptual content; the niche tools that do all converge on dialogue-vs-subtitles.

---

## 7. Recommendation for my-media-manager

Treat content identification as additional **evidence** in the redesigned pipeline, run only when cheaper evidence leaves the decision below the auto-approval bar. In order of payoff for the backlog actually sitting in ingest:

1. **Episode resolution for track-numbered disc rips** (Little House, Modern Family, Red Green, SpongeBob, Drake & Josh — the largest unresolved class). Pipeline: show identity from folder/IMDb tag → TMDB season list → OpenSubtitles per-episode subtitles for the candidate season(s), cached under `/ark/media/.subs-cache/<imdb>/S<nn>/` → for each file, prefer OCR of an embedded English subtitle track; else faster-whisper on 3–5 min after the intro → score against each candidate episode (token-F1 + ffsubsync alignment score) → accept when the best score beats the runner-up by a clear margin; also detects double-length titles (two episodes match disjoint halves). Reuse `mkv-episode-matcher`'s approach rather than its code (its CLI and quota handling are built for one-off runs).
2. **Deterministic signals into the evidence table now**: `ffprobe` segment title, chapter count, audio languages, duration-vs-runtime verdict. Cheap, and the duration check alone separates main features from extras far better than "longest file wins".
3. **Private fingerprint index** over the ~8,700 already-organized files, queried before any API call. Solves re-rips and the two-disc duplicates.
4. **Credits OCR via LocalAI** for the movie files with no year and no usable folder (`Anne_Frank.mkv`, `title_t00.mkv`): sample the last 8 minutes at 1 fps, OCR, extract names, confirm against TMDB credits of the top search candidates.
5. **OpenSubtitles moviehash** as a free bonus for scene releases only.

Policy: content evidence should be allowed to *confirm* an auto-decision (raise confidence past the threshold) and to *veto* one (transcript matches a different episode), and every verdict is stored with the transcript excerpt and the matched subtitle lines so the review UI can show exactly why.

**Dead ends to not spend time on:** Gracenote/Audible Magic/Content ID access; ACRCloud for unknown titles; AcoustID; moviehash for disc rips; runtime-only matching; thumbnail-vs-TheTVDB-still comparison (plexUtils tried it); LLM recall as the only matcher.

**Could not verify:** ACRCloud pricing; any sub-enterprise Gracenote tier; FileBot's official stance on content ID (forum returned 403); OpenSubtitles' per-10-second rate limit (third-party figure: 40 req/10 s); whether ISCC's video code is derived from the MPEG-7 signature; accuracy benchmarks for any episode-identification project (none publish them).
