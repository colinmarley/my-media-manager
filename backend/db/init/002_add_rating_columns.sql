-- Migration: add OMDB/TMDB rating and metadata columns
-- Safe to re-run (uses IF NOT EXISTS)

-- Movies
ALTER TABLE movies
  ADD COLUMN IF NOT EXISTS content_rating   text,
  ADD COLUMN IF NOT EXISTS imdb_rating      text,
  ADD COLUMN IF NOT EXISTS imdb_votes       text,
  ADD COLUMN IF NOT EXISTS metascore        text,
  ADD COLUMN IF NOT EXISTS box_office       text,
  ADD COLUMN IF NOT EXISTS tagline          text,
  ADD COLUMN IF NOT EXISTS tmdb_rating      text,
  ADD COLUMN IF NOT EXISTS tmdb_vote_count  integer,
  ADD COLUMN IF NOT EXISTS tmdb_data        jsonb DEFAULT '{}';

-- Series
ALTER TABLE series
  ADD COLUMN IF NOT EXISTS imdb_rating      text,
  ADD COLUMN IF NOT EXISTS imdb_votes       text,
  ADD COLUMN IF NOT EXISTS metascore        text,
  ADD COLUMN IF NOT EXISTS total_seasons    integer,
  ADD COLUMN IF NOT EXISTS total_episodes   integer,
  ADD COLUMN IF NOT EXISTS tmdb_rating      text,
  ADD COLUMN IF NOT EXISTS tmdb_vote_count  integer,
  ADD COLUMN IF NOT EXISTS tagline          text,
  ADD COLUMN IF NOT EXISTS tmdb_data        jsonb DEFAULT '{}';
