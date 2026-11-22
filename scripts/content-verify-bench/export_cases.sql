-- Ground truth for the content-verification bench: library files whose identity a human accepted.
-- One JSON object per line. Deterministic sample (md5 of the file id), spread across titles.
--   docker exec -i media-manager-db sh -c 'psql -U "$POSTGRES_USER" -d media_manager -At' \
--     < scripts/content-verify-bench/export_cases.sql > cases.jsonl
copy (
  with text_subs as (
    select mf.id,
           coalesce(mf.subtitle_tracks::text ~* '"format": "(ASS|SSA|UTF-8|Timed Text|SubRip)"', false) as has_text
    from media_files mf
  ),
  movies_main as (
    select 'movie' as kind, mf.id, mf.file_path, mf.duration_ms, m.title, left(m.release_date, 4) as year,
           m.imdb_id, null::text as series_tmdb_id, null::int as season, null::int as episode, ts.has_text,
           row_number() over (order by md5(mf.id::text)) as rn
    from media_files mf join movies m on m.id = mf.movie_id join text_subs ts on ts.id = mf.id
    where mf.role = 'main' and m.imdb_id like 'tt%' and mf.duration_ms > 3000000
      and coalesce(mf.is_available, true) and mf.location = 'library'
  ),
  extras as (
    select 'extra' as kind, mf.id, mf.file_path, mf.duration_ms, m.title, left(m.release_date, 4) as year,
           m.imdb_id, null::text as series_tmdb_id, null::int as season, null::int as episode, ts.has_text,
           row_number() over (partition by mf.movie_id order by md5(mf.id::text)) as per_title,
           md5(mf.id::text) as h
    from media_files mf join movies m on m.id = mf.movie_id join text_subs ts on ts.id = mf.id
    where mf.role = 'extra' and m.imdb_id like 'tt%' and mf.duration_ms > 60000
      and coalesce(mf.is_available, true) and mf.location = 'library'
  ),
  eps as (
    select 'episode' as kind, mf.id, mf.file_path, mf.duration_ms, s.title, null::text as year,
           s.imdb_id, s.tmdb_id::text as series_tmdb_id, mf.season_number as season, mf.episode_number as episode, ts.has_text,
           row_number() over (partition by mf.series_id, ts.has_text order by md5(mf.id::text)) as per_title,
           md5(mf.id::text) as h
    from media_files mf join series s on s.id = mf.series_id join text_subs ts on ts.id = mf.id
    where mf.role = 'episode' and (s.imdb_id like 'tt%' or s.tmdb_id is not null)
      and mf.season_number > 0 and mf.episode_number > 0 and mf.episode_end_number is null
      and mf.duration_ms > 600000 and coalesce(mf.is_available, true) and mf.location = 'library'
  ),
  picked as (
    select kind, id, file_path, duration_ms, title, year, imdb_id, series_tmdb_id, season, episode, has_text
      from movies_main where rn <= 30
    union all
    (select kind, id, file_path, duration_ms, title, year, imdb_id, series_tmdb_id, season, episode, has_text
       from extras where per_title = 1 order by h limit 30)
    union all
    (select kind, id, file_path, duration_ms, title, year, imdb_id, series_tmdb_id, season, episode, has_text
       from eps where per_title <= 2 and has_text order by h limit 40)
    union all
    (select kind, id, file_path, duration_ms, title, year, imdb_id, series_tmdb_id, season, episode, has_text
       from eps where per_title = 1 and not has_text order by h limit 20)
  )
  select json_build_object(
    'kind', kind, 'id', id, 'path', file_path, 'duration_ms', duration_ms, 'title', title, 'year', year,
    'imdb_id', imdb_id, 'series_tmdb_id', series_tmdb_id, 'season', season, 'episode', episode,
    'has_text_subs', has_text)
  from picked
) to stdout;
