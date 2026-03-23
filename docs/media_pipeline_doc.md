# Media Pipeline & Folder Structure Documentation

## Purpose
This document describes how media files flow through the system, including:
- Folder structure
- Processing stages
- Scripts involved
- Expected file transformations

This is intended to give AI coding assistants context when integrating applications with the media ingestion pipeline.

---

# High-Level Pipeline

```
Blu-ray Disc
   ↓
MakeMKV
   ↓
/data/media/rips
   ↓
HandBrake Auto Encode Script
   ↓
/data/media/encoded
   ↓
Metadata Processing App (your project)
   ↓
Jellyfin Library (Beelink NAS)
```

---

# Folder Structure

## Root Media Directory

```
/data/media/
├── rips/
├── encoded/
```

---

## Rips Directory (MakeMKV Output)

```
/data/media/rips/
├── movies/
│   └── Movie Name/
│       ├── title_t00.mkv
│       ├── title_t01.mkv
│       └── title_t02.mkv
└── shows/
    └── Show Name - Disc 1/
        ├── title_t00.mkv
        ├── title_t01.mkv
        └── title_t02.mkv
```

### Notes:
- Created by MakeMKV
- Each disc gets its own folder
- Each title on the disc becomes an MKV file

---

## Encoded Directory (HandBrake Output)

```
/data/media/encoded/
├── movies/
│   └── Movie Name/
│       ├── title_t00.mkv
│       ├── title_t01.mkv
│       └── title_t02.mkv
└── shows/
    └── Show Name - Disc 1/
        ├── title_t00.mkv
        ├── title_t01.mkv
        └── title_t02.mkv
```

### Notes:
- Final processed media lives here
- This is the **INGRESS POINT for your metadata project**
- Files are either:
  - encoded (main content)
  - copied (short extras)

---

# Processing Script

## Location

```
/data/scripts/auto_encode.sh
```

---

## Responsibilities

The script:

1. Scans:
```
/data/media/rips
```

2. Processes all `.mkv` files recursively

3. For each file:
   - Determines duration using ffprobe
   - Decides:
     - encode (main content, episodes)
     - copy (short extras)

4. Outputs to:
```
/data/media/encoded
```

5. Deletes original file after success

6. Removes empty folders

---

## Encoding Rules

| Condition | Action |
|----------|--------|
Duration < 10 min | Copy |
Duration ≥ 10 min | Encode |

---

## Encoding Settings

```
Video: H.265 (NVENC)
Quality: 21
Audio: Copy
Subtitles: All
```

---

# Ingress Point for Your Project

## Path

```
/data/media/encoded
```

Your application should:

1. Watch this directory
2. Detect new files
3. Extract metadata
4. Query:
   - TMDB
   - OMDB
5. Store metadata in DB
6. Determine:
   - movie vs show
7. Move file to final library

---

# Expected Output (Jellyfin)

## Movies

```
/mnt/beelink-media/movies/
└── Movie Name (Year)/
    └── Movie Name (Year).mkv
```

## Shows

```
/mnt/beelink-media/shows/
└── Show Name/
    └── Season 01/
        └── Show Name - s01e01.mkv
```

---

# Summary

This system provides:

- automated ripping pipeline
- GPU-accelerated encoding
- structured processing flow
- consistent ingress point

Integration target:

```
/data/media/encoded
```
