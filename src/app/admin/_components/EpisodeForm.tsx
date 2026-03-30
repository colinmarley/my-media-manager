import React, { useState, useEffect } from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import FirestoreService from '../../../service/firebase/FirestoreService';
import { FBEpisode } from '../../../types/firebase/FBEpisode.type';
import { CastEntry, DirectorEntry, DirectorReference, ImageFile } from '../../../types/firebase/FBCommon.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '@/service/omdb/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useEpisodeValidation from '../../../utils/useEpisodeValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';
import { prepareTitleForStorage } from '../../../utils/titleUtils';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';

interface EpisodeValidation {
  title: string | null;
  seasonId: string | null;
  seriesId: string | null;
  episodeNumber: string | null;
  countryOfOrigin: string | null;
  directors: string | null;
  imageFiles: string | null;
  releaseDate: string | null;
  runtime: string | null;
  topCast: string | null;
  writers: string | null;
  actors: string | null;
  genres: string | null;
  language: string | null;
  regionCode: string | null;
}

const EpisodeForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');
  const [directors, setDirectors] = useState<DirectorEntry[]>([]);
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [letterboxdLink, setLetterboxdLink] = useState('');
  const [plexLink, setPlexLink] = useState('');
  const [omdbData, setOmdbData] = useState<OmdbResponseFull | null>(null);
  const [omdbResults, setOmdbResults] = useState<OmdbSearchResponse[]>([]);
  const [releaseDate, setReleaseDate] = useState('');
  const [runtime, setRuntime] = useState('');
  const [topCast, setTopCast] = useState<string[]>([]);
  const [writers, setWriters] = useState<string[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [isPartOfCollection, setIsPartOfCollection] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [regionCode, setRegionCode] = useState('');

  const {
    validateTitle,
    validateSeasonId,
    validateSeriesId,
    validateEpisodeNumber,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateReleaseDate,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateActors,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  } = useEpisodeValidation();

  const [errors, setErrors] = useState<EpisodeValidation>({
    title: null,
    seasonId: null,
    seriesId: null,
    episodeNumber: null,
    countryOfOrigin: null,
    directors: null,
    imageFiles: null,
    releaseDate: null,
    runtime: null,
    topCast: null,
    writers: null,
    actors: null,
    genres: null,
    language: null,
    regionCode: null,
  });

  useEffect(() => {
    setTitle(omdbData?.Title || title);
    setCountryOfOrigin(omdbData?.Country || countryOfOrigin);
    omdbData?.Director.split(',').forEach((directorName: string) => handleUpdateDirectorList(directorName.trim()));
    if (omdbData?.Poster) { setImageFiles([...imageFiles, { fileName: omdbData?.Poster || '', fileSize: 0, resolution: '', format: '' }])};
    setLetterboxdLink(omdbData?.Website || letterboxdLink);
    setReleaseDate(omdbData?.Released || releaseDate);
    setRuntime(omdbData?.Runtime || runtime);
    setTopCast(omdbData?.Actors.split(',').map((actor: string) => actor.trim()) || topCast);
    setWriters(omdbData?.Writer.split(',').map((writer: string) => writer.trim()) || writers);
    setGenres(omdbData?.Genre.split(',').map((genre: string) => genre.trim()) || genres);
    setLanguage(omdbData?.Language || language);
  }, [omdbData]);

  const handleEpisodeTitleSearch = async (title: string) => {
    const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
    setOmdbResults(omdbSearchResults);
  };

  const handleUpdateDirectorList = (directorName: string) => {
    setDirectors([...directors, { fullName: directorName, title: '' }]);
  };

  const handleAddDirector = () => {
    // TODO: Check that the Director exists in firebase Collection prior to adding
    setDirectors([...directors, { fullName: '', title: '' }]);
  };

  const handleDirectorChange = (index: number, field: keyof DirectorEntry, value: string) => {
    const newDirectors = [...directors];
    newDirectors[index][field] = value;
    setDirectors(newDirectors);
  };

  const handleEpisodeSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
    setTitle(selectedTitle);
    const fullEpisodeData = await retrieveMediaDataById(selectedImdbId);
    setOmdbData(fullEpisodeData);
    setOmdbResults([]); // Clear the search results after selection
  };

  const directorEntryToDirector = (entry: DirectorEntry): DirectorReference => {
    return {
      fullName: entry.fullName,
      notes: '',
      portfolio: [],
      otherCollections: [],
      awards: [],
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = {
      title: validateTitle(title),
      seasonId: validateSeasonId(seasonId),
      seriesId: validateSeriesId(seriesId),
      episodeNumber: validateEpisodeNumber(episodeNumber),
      countryOfOrigin: validateCountryOfOrigin(countryOfOrigin),
      directors: validateDirectors(directors.map(directorEntryToDirector)),
      imageFiles: validateImageFiles(imageFiles),
      releaseDate: validateReleaseDate(releaseDate),
      runtime: validateRuntime(runtime),
      topCast: validateTopCast(topCast),
      writers: validateWriters(writers),
      actors: validateActors(actors),
      genres: validateGenres(genres),
      language: validateLanguage(language),
      regionCode: validateRegionCode(regionCode),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    const combinedActors = Array.from(new Set([...topCast, ...actors].map((entry) => entry.trim()).filter(Boolean)));

    const episode: FBEpisode = {
      id: '', // Firebase will generate the ID
      ...prepareTitleForStorage(title),
      seasonId,
      seriesId,
      episodeNumber: Number(episodeNumber),
      notes,
      countryOfOrigin: countryOfOrigin
        .split(',')
        .map((country) => country.trim())
        .filter(Boolean),
      directors: directors.map(directorEntryToDirector),
      imageFiles,
      letterboxdLink,
      plexLink,
      airDate: releaseDate,
      releaseIds: [],
      runtime,
      topCast: combinedActors.map<CastEntry>((actorName) => ({ actorName })),
      writers,
      isPartOfCollection,
      collectionIds,
      genres,
      languages: language
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      regionCode,
      externalIds: omdbData?.imdbID ? { imdbId: omdbData.imdbID } : undefined,
      synopsis: omdbData?.Plot || undefined,
      thumbnailUrl: omdbData?.Poster || undefined,
    };

    const service = new FirestoreService('episodes');
    await service.addDocument(episode);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Episode</Typography>
        </Grid>
        <Grid size={12}>
          <FormSectionStack>
            <FormSection title="Parent Selection" description="Link this episode to its parent series and season." titleTooltip="Each episode must reference both its series and season documents to keep hierarchy queries stable.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Series ID" tooltip="Required. The Firestore document ID of the parent series." />}
                    value={seriesId}
                    onChange={(e) => setSeriesId(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.seriesId}
                    helperText={errors.seriesId}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Season ID" tooltip="Required. The Firestore document ID of the parent season." />}
                    value={seasonId}
                    onChange={(e) => setSeasonId(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.seasonId}
                    helperText={errors.seasonId}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Core Details" description="Episode identity and timing." titleTooltip="Capture the canonical episode title, numbering, air/release timing, and any episode-specific notes.">
              <Grid container spacing={2}>
                <Grid size={9}>
                  <TextField
                    label={<FieldLabel label="Title" tooltip="Required. Official episode title." />}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.title}
                    helperText={errors.title}
                  />
                </Grid>
                <Grid size={3}>
                  <Button onClick={() => handleEpisodeTitleSearch(title)} variant="contained" color="primary">
                    Search
                  </Button>
                </Grid>
                {omdbResults.length > 0 && (
                  <Grid size={12}>
                    <List dense>
                      {omdbResults.map((result, index) => (
                        <ListItem key={`search-result-${index}`} disablePadding>
                          <ListItemButton onClick={() => handleEpisodeSelect(result.Title, result.Year, result.imdbID)}>
                            <ListItemText primary={`${result.Title} (${result.Year})`} />
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}
                <Grid size={3}>
                  <TextField
                    label={<FieldLabel label="Episode Number" tooltip="Episode order number within the selected season." />}
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.episodeNumber}
                    helperText={errors.episodeNumber}
                  />
                </Grid>
                <Grid size={4}>
                  <TextField
                    label={<FieldLabel label="Release Date" tooltip="Original air date in YYYY-MM-DD format when available." />}
                    value={releaseDate}
                    onChange={(e) => setReleaseDate(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.releaseDate}
                    helperText={errors.releaseDate}
                  />
                </Grid>
                <Grid size={5}>
                  <TextField
                    label={<FieldLabel label="Runtime" tooltip="Episode runtime in h:mm:ss format." />}
                    value={runtime}
                    onChange={(e) => setRuntime(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="h:mm:ss"
                    error={!!errors.runtime}
                    helperText={errors.runtime}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Country of Origin" tooltip="Comma-separated production countries for this episode." />}
                    value={countryOfOrigin}
                    onChange={(e) => setCountryOfOrigin(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.countryOfOrigin}
                    helperText={errors.countryOfOrigin}
                  />
                </Grid>
                <Grid size={12}>
                  <TextField
                    label={<FieldLabel label="Notes" tooltip="Optional free-form notes about this episode, such as cut versions or special edits." />}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    multiline
                    rows={3}
                    fullWidth
                    sx={{ label: { color: 'white' } }}
                  />
                </Grid>
                <Grid size={6}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={isPartOfCollection}
                        onChange={(e) => setIsPartOfCollection(e.target.checked)}
                      />
                    }
                    label={<FieldLabel label="Is Part of Collection" tooltip="Enable when this episode belongs to one or more curated collections." />}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Credits" description="Directors, cast and writers." titleTooltip="Store primary creative credits and performer names used in episode detail and search views.">
              <Grid container spacing={2}>
                <Grid size={12}>
                  <Typography variant="subtitle1" color="white">Directors</Typography>
                  {directors.map((director, index) => (
                    <Grid container spacing={2} key={index} sx={{ mb: 1 }}>
                      <Grid size={6}>
                        <TextField
                          label={<FieldLabel label="Name" tooltip="Director's full name." />}
                          value={director.fullName}
                          onChange={(e) => handleDirectorChange(index, 'fullName', e.target.value)}
                          size="small"
                          fullWidth
                          sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                        />
                      </Grid>
                      <Grid size={6}>
                        <TextField
                          label={<FieldLabel label="Title" tooltip="Optional role descriptor, such as Co-director or Guest Director." />}
                          value={director.title}
                          onChange={(e) => handleDirectorChange(index, 'title', e.target.value)}
                          size="small"
                          fullWidth
                          sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                        />
                      </Grid>
                    </Grid>
                  ))}
                  <Button onClick={handleAddDirector} size="small">Add Director</Button>
                </Grid>
                <Grid size={4}>
                  <TextField
                    label={<FieldLabel label="Top Cast" tooltip="Comma-separated principal cast names." />}
                    value={topCast.join(', ')}
                    onChange={(e) => setTopCast(e.target.value.split(', '))}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.topCast}
                    helperText={errors.topCast}
                  />
                </Grid>
                <Grid size={4}>
                  <TextField
                    label={<FieldLabel label="Writers" tooltip="Comma-separated writer names credited for this episode." />}
                    value={writers.join(', ')}
                    onChange={(e) => setWriters(e.target.value.split(', '))}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.writers}
                    helperText={errors.writers}
                  />
                </Grid>
                <Grid size={4}>
                  <TextField
                    label={<FieldLabel label="Actors" tooltip="Comma-separated actor names appearing in this episode." />}
                    value={actors.join(', ')}
                    onChange={(e) => setActors(e.target.value.split(', '))}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.actors}
                    helperText={errors.actors}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Classification" description="Genres and language metadata." titleTooltip="Add taxonomy and language values that support filtering, playback context, and metadata exports.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Genres" tooltip="Comma-separated genres for this episode." />}
                    value={genres.join(', ')}
                    onChange={(e) => setGenres(e.target.value.split(', '))}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.genres}
                    helperText={errors.genres}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Language" tooltip="Comma-separated spoken languages used in this episode." />}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.language}
                    helperText={errors.language}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Region Code" tooltip="Primary release region code, such as US or UK." />}
                    value={regionCode}
                    onChange={(e) => setRegionCode(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="e.g. US, UK"
                    error={!!errors.regionCode}
                    helperText={errors.regionCode}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Links and Media" description="External links and imagery." titleTooltip="Optional external URLs and artwork references for this episode record.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Letterboxd Link" tooltip="Optional URL to an episode page on Letterboxd or similar tracking site." />}
                    value={letterboxdLink}
                    onChange={(e) => setLetterboxdLink(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Plex Link" tooltip="Optional URL to this episode in your Plex library." />}
                    value={plexLink}
                    onChange={(e) => setPlexLink(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                  />
                </Grid>
                <Grid size={12}>
                  <ImageSearch />
                </Grid>
              </Grid>
            </FormSection>
          </FormSectionStack>
        </Grid>
        <Grid size={3}>
          <SubmitButton
            label="Add Episode"
            onClick={handleSubmit}
            disabled={!omdbData} />
        </Grid>
      </Grid>
    </form>
  );
};

export default EpisodeForm;