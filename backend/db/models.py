import sqlalchemy as sa
from sqlalchemy import (
    Column,
    Text,
    Integer,
    BigInteger,
    Boolean,
    ARRAY,
    Float,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, INET
from sqlalchemy.sql import func
from sqlalchemy.types import DateTime

from db.database import Base


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class AppConfig(Base):
    __tablename__ = "app_config"

    key   = Column(Text, primary_key=True)
    value = Column(Text, nullable=False)


class Session(Base):
    __tablename__ = "sessions"

    session_id = Column(Text, primary_key=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    ip_address = Column(INET)
    user_agent = Column(Text)


# ---------------------------------------------------------------------------
# Media Catalog
# ---------------------------------------------------------------------------

class Movie(Base):
    __tablename__ = "movies"

    id                 = Column(Text, primary_key=True)
    title              = Column(Text, nullable=False)
    release_date       = Column(Text)
    runtime            = Column(Text)
    countries          = Column(ARRAY(Text), default=[])
    genres             = Column(ARRAY(Text), default=[])
    languages          = Column(ARRAY(Text), default=[])
    awards             = Column(Text)
    content_rating     = Column(Text)              # OMDB Rated (PG-13, R, etc.)
    imdb_rating        = Column(Text)              # OMDB imdbRating (e.g. "8.1")
    imdb_votes         = Column(Text)              # OMDB imdbVotes (e.g. "1,234,567")
    metascore          = Column(Text)              # OMDB Metascore
    box_office         = Column(Text)              # OMDB BoxOffice
    tagline            = Column(Text)              # TMDB tagline
    tmdb_rating        = Column(Text)              # TMDB vote_average
    tmdb_vote_count    = Column(Integer)           # TMDB vote_count
    notes              = Column(Text)
    omdb_data          = Column(JSONB, default={})
    tmdb_data          = Column(JSONB, default={}) # Full TMDB detail response
    imdb_id            = Column(Text)
    tmdb_id            = Column(Text)
    rotten_tomatoes_id = Column(Text)
    metacritic_id      = Column(Text)
    letterboxd_id      = Column(Text)
    image_files        = Column(JSONB, default=[])
    content_ratings    = Column(JSONB, default=[])
    collection_id      = Column(Text)
    collection_name    = Column(Text)
    collection_order   = Column(Integer)
    assignment_summary = Column(JSONB, default={})
    jellyfin_info      = Column(JSONB, default={})
    raw_data           = Column(JSONB, default={})  # Full catalog document
    created_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Release(Base):
    __tablename__ = "releases"

    id               = Column(Text, primary_key=True)
    title            = Column(Text, nullable=False)
    year             = Column(Integer)
    media_type       = Column(Text)
    edition          = Column(Text)
    publisher        = Column(Text)
    territory        = Column(Text)
    release_date     = Column(Text)
    spine_number     = Column(Text)
    out_of_print     = Column(Boolean, default=False)
    upc              = Column(Text)
    contains_extras  = Column(Boolean, default=False)
    extras           = Column(JSONB, default=[])
    contains_inserts = Column(Boolean, default=False)
    inserts          = Column(JSONB, default=[])
    image_files      = Column(JSONB, default=[])
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ReleaseMovie(Base):
    __tablename__ = "release_movies"

    release_id = Column(Text, ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    movie_id   = Column(Text, ForeignKey("movies.id",   ondelete="CASCADE"), primary_key=True)


class Disc(Base):
    __tablename__ = "discs"

    id                        = Column(Text, primary_key=True)
    title                     = Column(Text, nullable=False)
    release_id                = Column(Text, ForeignKey("releases.id", ondelete="SET NULL"))
    format                    = Column(Text)
    disc_number               = Column(Integer)
    barcode                   = Column(Text)
    region_code               = Column(Text)
    language                  = Column(Text)
    subtitles                 = Column(ARRAY(Text), default=[])
    is_part_of_set            = Column(Boolean, default=False)
    is_rental_disc            = Column(Boolean, default=False)
    contains_special_features = Column(Boolean, default=False)
    purchase_date             = Column(Text)
    condition                 = Column(Text)
    release_date              = Column(Text)
    video_files               = Column(JSONB, default=[])
    image_files               = Column(JSONB, default=[])
    raw_data                  = Column(JSONB, default={})  # Full Firebase document for backward compatibility
    created_at                = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at                = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Series(Base):
    __tablename__ = "series"

    id                 = Column(Text, primary_key=True)
    title              = Column(Text, nullable=False)
    countries          = Column(ARRAY(Text), default=[])
    genres             = Column(ARRAY(Text), default=[])
    languages          = Column(ARRAY(Text), default=[])
    running_years      = Column(ARRAY(Text), default=[])
    awards             = Column(Text)
    content_rating     = Column(Text)              # OMDB Rated (TV-14, TV-MA, etc.)
    imdb_rating        = Column(Text)              # OMDB imdbRating
    imdb_votes         = Column(Text)              # OMDB imdbVotes
    metascore          = Column(Text)              # OMDB Metascore
    total_seasons      = Column(Integer)           # OMDB TotalSeasons / TMDB number_of_seasons
    total_episodes     = Column(Integer)           # TMDB number_of_episodes
    tmdb_rating        = Column(Text)              # TMDB vote_average
    tmdb_vote_count    = Column(Integer)           # TMDB vote_count
    tagline            = Column(Text)              # TMDB tagline
    notes              = Column(Text)
    status             = Column(Text)
    network            = Column(Text)
    omdb_data          = Column(JSONB, default={})
    tmdb_data          = Column(JSONB, default={}) # Full TMDB detail response
    imdb_id            = Column(Text)
    tmdb_id            = Column(Text)
    tvdb_id            = Column(Text)
    tv_maze_id         = Column(Text)
    image_files        = Column(JSONB, default=[])
    series_summary     = Column(JSONB, default={})
    assignment_summary = Column(JSONB, default={})
    jellyfin_info      = Column(JSONB, default={})
    raw_data           = Column(JSONB, default={})  # Full catalog document
    created_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ReleaseSeries(Base):
    __tablename__ = "release_series"

    release_id = Column(Text, ForeignKey("releases.id", ondelete="CASCADE"), primary_key=True)
    series_id  = Column(Text, ForeignKey("series.id",   ondelete="CASCADE"), primary_key=True)


class Season(Base):
    __tablename__ = "seasons"

    id                   = Column(Text, primary_key=True)
    series_id            = Column(Text, ForeignKey("series.id", ondelete="CASCADE"), nullable=False)
    series_title         = Column(Text, nullable=False)
    season_number        = Column(Integer, nullable=False)
    season_name          = Column(Text)
    alternate_title      = Column(Text)
    total_episodes       = Column(Integer)
    first_aired          = Column(Text)
    last_aired           = Column(Text)
    release_year         = Column(Integer)
    countries            = Column(ARRAY(Text), default=[])
    languages            = Column(ARRAY(Text), default=[])
    overview             = Column(Text)
    image_files          = Column(JSONB, default=[])
    poster_image         = Column(Text)
    plex_link            = Column(Text)
    jellyfin_folder_id   = Column(Text)
    jellyfin_folder_name = Column(Text)
    episodes_with_files  = Column(Integer, default=0)
    total_files          = Column(Integer, default=0)
    total_file_size      = Column(BigInteger, default=0)
    omdb_data            = Column(JSONB, default={})
    created_at           = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at           = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("series_id", "season_number"),)


class Episode(Base):
    __tablename__ = "episodes"

    id                = Column(Text, primary_key=True)
    series_id         = Column(Text, ForeignKey("series.id",  ondelete="CASCADE"), nullable=False)
    season_id         = Column(Text, ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False)
    series_title      = Column(Text, nullable=False)
    season_number     = Column(Integer, nullable=False)
    episode_number    = Column(Integer, nullable=False)
    episode_numbers   = Column(ARRAY(Integer), default=[])
    title             = Column(Text)
    overview          = Column(Text)
    air_date          = Column(Text)
    runtime           = Column(Integer)
    runtime_formatted = Column(Text)
    countries         = Column(ARRAY(Text), default=[])
    languages         = Column(ARRAY(Text), default=[])
    image_files       = Column(JSONB, default=[])
    still_image       = Column(Text)
    plex_link         = Column(Text)
    imdb_id           = Column(Text)
    tmdb_id           = Column(Text)
    tvdb_id           = Column(Text)
    has_file          = Column(Boolean, default=False)
    file_id           = Column(Text)
    file_count        = Column(Integer, default=0)
    jellyfin_filename = Column(Text)
    omdb_data         = Column(JSONB, default={})
    notes             = Column(Text)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Actor(Base):
    __tablename__ = "actors"

    id         = Column(Text, primary_key=True)
    full_name  = Column(Text, nullable=False)
    birthplace = Column(Text)
    birthday   = Column(Text)
    notes      = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Director(Base):
    __tablename__ = "directors"

    id         = Column(Text, primary_key=True)
    full_name  = Column(Text, nullable=False)
    birthplace = Column(Text)
    birthday   = Column(Text)
    notes      = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MovieActor(Base):
    __tablename__ = "movie_actors"

    movie_id   = Column(Text, ForeignKey("movies.id",  ondelete="CASCADE"), primary_key=True)
    actor_id   = Column(Text, ForeignKey("actors.id",  ondelete="CASCADE"), primary_key=True)
    characters = Column(ARRAY(Text), default=[])


class MovieDirector(Base):
    __tablename__ = "movie_directors"

    movie_id    = Column(Text, ForeignKey("movies.id",    ondelete="CASCADE"), primary_key=True)
    director_id = Column(Text, ForeignKey("directors.id", ondelete="CASCADE"), primary_key=True)
    title       = Column(Text)


class SeriesActor(Base):
    __tablename__ = "series_actors"

    series_id  = Column(Text, ForeignKey("series.id", ondelete="CASCADE"), primary_key=True)
    actor_id   = Column(Text, ForeignKey("actors.id", ondelete="CASCADE"), primary_key=True)
    characters = Column(ARRAY(Text), default=[])


class SeriesDirector(Base):
    __tablename__ = "series_directors"

    series_id   = Column(Text, ForeignKey("series.id",    ondelete="CASCADE"), primary_key=True)
    director_id = Column(Text, ForeignKey("directors.id", ondelete="CASCADE"), primary_key=True)
    seasons     = Column(ARRAY(Text), default=[])
    title       = Column(Text)


# ---------------------------------------------------------------------------
# Library Scanning
# ---------------------------------------------------------------------------

class LibraryPath(Base):
    __tablename__ = "library_paths"

    id               = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    name             = Column(Text, nullable=False)
    root_path        = Column(Text, nullable=False)
    media_type       = Column(Text, nullable=False, default="mixed")
    is_active        = Column(Boolean, nullable=False, default=True)
    last_scanned     = Column(DateTime(timezone=True))
    last_scan_id     = Column(Text)
    last_scan_status = Column(Text)
    scan_progress    = Column(JSONB, default={})
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ScanResult(Base):
    __tablename__ = "scan_results"

    id                = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    library_path_id   = Column(Text, ForeignKey("library_paths.id", ondelete="SET NULL"))
    library_path      = Column(Text, nullable=False)
    status            = Column(Text, nullable=False, default="running")
    total_items       = Column(Integer, default=0)
    files_found       = Column(Integer, default=0)
    directories_found = Column(Integer, default=0)
    start_time        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    end_time          = Column(DateTime(timezone=True))
    error_message     = Column(Text)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ScannedFile(Base):
    __tablename__ = "scanned_files"

    id               = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    scan_id          = Column(Text, ForeignKey("scan_results.id", ondelete="CASCADE"))
    library_path_id  = Column(Text, ForeignKey("library_paths.id", ondelete="SET NULL"))
    file_path        = Column(Text, nullable=False)
    file_name        = Column(Text, nullable=False)
    folder_path      = Column(Text)
    extension        = Column(Text)
    media_type       = Column(Text)
    status           = Column(Text, default="found")
    file_size        = Column(BigInteger)
    modified_time    = Column(DateTime(timezone=True))
    media_metadata   = Column(JSONB, default={})
    parsed_info      = Column(JSONB, default={})
    discovered_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ScannedDirectory(Base):
    __tablename__ = "scanned_directories"

    id              = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    scan_id         = Column(Text, ForeignKey("scan_results.id", ondelete="CASCADE"))
    library_path_id = Column(Text, ForeignKey("library_paths.id", ondelete="SET NULL"))
    dir_path        = Column(Text, nullable=False)
    dir_name        = Column(Text, nullable=False)
    media_type      = Column(Text)
    status          = Column(Text, default="found")
    dir_metadata    = Column("metadata", JSONB, default={})
    discovered_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MediaFile(Base):
    __tablename__ = "media_files"

    id                  = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    scan_id             = Column(Text, ForeignKey("scan_results.id", ondelete="SET NULL"))
    library_path_id     = Column(Text, ForeignKey("library_paths.id", ondelete="SET NULL"))
    file_path           = Column(Text, nullable=False, unique=True)
    file_name           = Column(Text, nullable=False)
    file_extension      = Column(Text)
    folder_path         = Column(Text)
    relative_path       = Column(Text)
    file_size           = Column(BigInteger)
    file_size_formatted = Column(Text)
    checksum            = Column(Text)
    created_date        = Column(DateTime(timezone=True))
    modified_date       = Column(DateTime(timezone=True))
    last_scanned_date   = Column(DateTime(timezone=True))
    is_available        = Column(Boolean, default=True)
    detected_media_type = Column(Text)
    confidence          = Column(Integer, default=0)
    video_metadata      = Column(JSONB, default={})
    audio_tracks        = Column(JSONB, default=[])
    subtitle_tracks     = Column(JSONB, default=[])
    parsed_info         = Column(JSONB, default={})
    assignment_status   = Column(Text, default="unassigned")
    assigned_to_type    = Column(Text)
    assigned_to_id      = Column(Text)
    disc_id             = Column(Text, ForeignKey("discs.id", ondelete="SET NULL"))
    needs_organization  = Column(Boolean, default=False)
    target_path         = Column(Text)
    organization_status = Column(Text)
    tags                = Column(ARRAY(Text), default=[])
    notes               = Column(Text)
    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class MediaAssignment(Base):
    __tablename__ = "media_assignments"

    id                      = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    primary_file_id         = Column(Text, ForeignKey("media_files.id", ondelete="SET NULL"))
    media_type              = Column(Text, nullable=False)
    media_id                = Column(Text, nullable=False)
    series_id               = Column(Text)
    season_id               = Column(Text)
    season_number           = Column(Integer)
    episode_number          = Column(Integer)
    version                 = Column(Text)
    is_preferred_version    = Column(Boolean, default=False)
    target_folder_structure = Column(JSONB, default={})
    organization_status     = Column(Text, default="pending")
    organization_date       = Column(DateTime(timezone=True))
    organization_error      = Column(Text)
    operations              = Column(JSONB, default=[])
    assigned_by             = Column(Text)
    assigned_date           = Column(DateTime(timezone=True))
    confidence              = Column(Integer, default=0)
    is_manual_assignment    = Column(Boolean, default=False)
    match_data              = Column(JSONB, default={})
    notes                   = Column(Text)
    created_at              = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at              = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AssignmentExtraFile(Base):
    __tablename__ = "assignment_extra_files"

    assignment_id = Column(Text, ForeignKey("media_assignments.id", ondelete="CASCADE"), primary_key=True)
    media_file_id = Column(Text, ForeignKey("media_files.id",       ondelete="CASCADE"), primary_key=True)


class JellyfinFolder(Base):
    __tablename__ = "jellyfin_folders"

    id               = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    folder_path      = Column(Text, nullable=False, unique=True)
    folder_name      = Column(Text, nullable=False)
    folder_type      = Column(Text)
    media_type       = Column(Text)
    media_id         = Column(Text)
    season_number    = Column(Integer)
    media_title      = Column(Text)
    year             = Column(Integer)
    imdb_id          = Column(Text)
    jellyfin_name    = Column(Text)
    video_files      = Column(JSONB, default=[])
    subtitle_files   = Column(JSONB, default=[])
    audio_files      = Column(JSONB, default=[])
    image_files      = Column(JSONB, default=[])
    extra_folders    = Column(JSONB, default=[])
    created_date     = Column(DateTime(timezone=True))
    last_verified    = Column(DateTime(timezone=True))
    is_valid         = Column(Boolean, default=True)
    validation_errors = Column(JSONB, default=[])
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ComplianceScan(Base):
    __tablename__ = "compliance_scans"

    id            = Column(Text, primary_key=True)
    library_path  = Column(Text, nullable=False)
    status        = Column(Text, nullable=False, default="running")
    triggered_by  = Column(Text)
    summary       = Column(JSONB, default={})
    started_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at  = Column(DateTime(timezone=True))
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ComplianceFinding(Base):
    __tablename__ = "compliance_findings"

    id                  = Column(Text, primary_key=True)
    scan_id             = Column(Text, ForeignKey("compliance_scans.id", ondelete="CASCADE"), nullable=False)
    media_type          = Column(Text, nullable=False, default="movie")
    media_id            = Column(Text)
    folder_path         = Column(Text)
    file_path           = Column(Text)
    issue_type          = Column(Text, nullable=False)
    severity            = Column(Text, nullable=False, default="medium")
    confidence          = Column(Integer, default=0)
    current_state       = Column(JSONB, default={})
    expected_state      = Column(JSONB, default={})
    rationale           = Column(Text)
    status              = Column(Text, nullable=False, default="open")
    created_at          = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ComplianceAction(Base):
    __tablename__ = "compliance_actions"

    id            = Column(Text, primary_key=True)
    finding_id    = Column(Text, ForeignKey("compliance_findings.id", ondelete="CASCADE"), nullable=False)
    action_type   = Column(Text, nullable=False)
    source_path   = Column(Text)
    target_path   = Column(Text)
    payload       = Column(JSONB, default={})
    selected      = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ComplianceReviewEvent(Base):
    __tablename__ = "compliance_review_events"

    id            = Column(Text, primary_key=True)
    finding_id    = Column(Text, ForeignKey("compliance_findings.id", ondelete="CASCADE"), nullable=False)
    event_type    = Column(Text, nullable=False)
    actor         = Column(Text)
    note          = Column(Text)
    event_payload = Column(JSONB, default={})
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MediaMatch(Base):
    __tablename__ = "media_matches"

    id         = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    file_info  = Column(JSONB, nullable=False)
    confidence = Column(Integer, default=0)
    media_id   = Column(Text)
    media_type = Column(Text)
    suggestions = Column(JSONB, default=[])
    status     = Column(Text, default="unmatched")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Ingress Automation
# ---------------------------------------------------------------------------

class IngressQueueItem(Base):
    __tablename__ = "ingress_queue"

    id                = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    file_path         = Column(Text, nullable=False)
    file_name         = Column(Text, nullable=False)
    ingress_path      = Column(Text)
    file_size         = Column(BigInteger)
    detected_at       = Column(DateTime(timezone=True))
    queued_at         = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    status            = Column(Text, nullable=False, default="pending")
    priority          = Column(Integer, default=5)
    attempts          = Column(Integer, default=0)
    last_attempt      = Column(DateTime(timezone=True))
    processed_at      = Column(DateTime(timezone=True))
    last_error        = Column(Text)
    confidence_score  = Column(Integer)
    assignment_id     = Column(Text, ForeignKey("media_assignments.id", ondelete="SET NULL"))
    parsed_info       = Column(JSONB, default={})
    best_match        = Column(JSONB, default={})
    match_candidates  = Column(JSONB, default=[])
    media_duration_ms = Column(BigInteger)
    proposed_path     = Column(Text)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class IngressProcessingHistory(Base):
    __tablename__ = "ingress_processing_history"

    id            = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    queue_item_id = Column(Text)
    snapshot      = Column(JSONB, nullable=False)
    created_at    = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class IngressConfig(Base):
    __tablename__ = "ingress_config"

    id         = Column(Text, primary_key=True, default="current")
    config     = Column(JSONB, nullable=False, default={})
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


# ---------------------------------------------------------------------------
# Generic Data Store — replaces Firestore for misc collections
# (actors, directors, writers, AllMedia, MyMedia, releases, etc.)
# ---------------------------------------------------------------------------

class GenericDataStore(Base):
    __tablename__ = "generic_data"

    id         = Column(Text, primary_key=True)
    collection = Column(Text, nullable=False, index=True)
    data       = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

# ---------------------------------------------------------------------------
# Tape Digitization
# ---------------------------------------------------------------------------

class TapeSession(Base):
    __tablename__ = "tape_sessions"

    id               = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    created_at       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    tape_type        = Column(Text, nullable=False)
    brand            = Column(Text)
    condition        = Column(Text)
    recording_speed  = Column(Text)
    label_notes      = Column(Text)
    source_path      = Column(Text, nullable=False)
    destination_base = Column(Text, nullable=False)
    apply_ffmpeg     = Column(Boolean, nullable=False, default=False)


class TapeSessionFile(Base):
    __tablename__ = "tape_session_files"

    id                = Column(Text, primary_key=True, server_default=sa.text("(gen_random_uuid())::text"))
    session_id        = Column(Text, ForeignKey("tape_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    file_path         = Column(Text, nullable=False)
    file_name         = Column(Text, nullable=False)
    content_type      = Column(Text, nullable=False)
    duration_seconds  = Column(Float)
    resolution        = Column(Text)
    codec             = Column(Text)
    file_size_bytes   = Column(BigInteger)
    destination_path  = Column(Text)
    processing_status = Column(Text, nullable=False, default="pending")
    tape_id           = Column(Text, nullable=True, index=True)
    metadata_json     = Column(JSONB, default={})
