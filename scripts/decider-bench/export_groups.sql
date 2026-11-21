-- One row per movie folder group: library files with a known role.
copy (
  with f as (
    select mf.movie_id, mf.file_name, mf.folder_path, mf.relative_path, mf.file_size, mf.duration_ms, mf.role
    from media_files mf
    where mf.movie_id is not null and mf.role in ('main','version','extra')
      and mf.duration_ms > 0 and coalesce(mf.is_available, true)
  ),
  g as (
    select movie_id,
           count(*) filter (where role='main') mains,
           count(*) filter (where role='version') versions,
           count(*) filter (where role='extra') extras
    from f group by 1
  )
  select json_build_object(
    'movie_id', m.id, 'title', m.title, 'year', left(m.release_date, 4),
    'runtime', m.runtime,
    'files', (select json_agg(json_build_object(
                'name', f.file_name, 'rel', f.relative_path, 'size', f.file_size,
                'ms', f.duration_ms, 'role', f.role) order by f.duration_ms desc)
              from f where f.movie_id = m.id)
  )
  from g join movies m on m.id = g.movie_id
  where g.mains = 1 and (g.versions > 0 or g.extras > 0)
) to stdout;
