import React, { useState, useEffect } from 'react';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import CatalogService from '../../../service/catalog/CatalogService';
import { CatalogSeries } from '../../../types/catalog/Series.type';
import { CastEntry, DirectorEntry, DirectorReference, ImageFile } from '../../../types/catalog/Common.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '@/service/omdb/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useSeriesValidation from '../../../utils/useSeriesValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';
import { prepareTitleForStorage } from '../../../utils/titleUtils';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';
import { NestedSeasonEditor, SeasonEntry } from './forms/editors';

interface SeriesValidation {
  title: string | null;
  countryOfOrigin: string | null;
  directors: string | null;
  imageFiles: string | null;
  runningDates: string | null;
  runtime: string | null;
  topCast: string | null;
  writers: string | null;
  seasons: string | null;
  genres: string | null;
  language: string | null;
  regionCode: string | null;
}

const SeriesForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');
  const [directors, setDirectors] = useState<DirectorEntry[]>([]);
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [letterboxdLink, setLetterboxdLink] = useState('');
  const [plexLink, setPlexLink] = useState('');
  const [omdbData, setOmdbData] = useState<OmdbResponseFull | null>(null);
  const [omdbResults, setOmdbResults] = useState<OmdbSearchResponse[]>([]);
  const [runningDates, setRunningDates] = useState('');
  const [runtime, setRuntime] = useState('');
  const [topCast, setTopCast] = useState<string[]>([]);
  const [writers, setWriters] = useState<string[]>([]);
  const [isPartOfCollection, setIsPartOfCollection] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<SeasonEntry[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [regionCode, setRegionCode] = useState('');

  const {
    validateTitle,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateRunningDates,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateSeasons,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  } = useSeriesValidation();

  const [errors, setErrors] = useState<SeriesValidation>({
    title: null,
    countryOfOrigin: null,
    directors: null,
    imageFiles: null,
    runningDates: null,
    runtime: null,
    topCast: null,
    writers: null,
    seasons: null,
    genres: null,
    language: null,
    regionCode: null,
  });

  useEffect(() => {
    setTitle(omdbData?.Title || title);
    setCountryOfOrigin(omdbData?.Country || countryOfOrigin);
    setDirectors(omdbData?.Director.split(',').map((director: string) => ({ fullName: director.trim(), title: '' })).concat(directors) || directors);
    if (omdbData?.Poster) { setImageFiles([...imageFiles, { fileName: omdbData?.Poster || '', fileSize: 0, resolution: '', format: '' }])};
    setLetterboxdLink(omdbData?.Website || letterboxdLink);
    setRunningDates(omdbData?.Released || runningDates);
    setRuntime(omdbData?.Runtime || runtime);
    setTopCast(omdbData?.Actors.split(',').map((actor: string) => actor.trim()) || topCast);
    setWriters(omdbData?.Writer.split(',').map((writer: string) => writer.trim()) || writers);
    setGenres(omdbData?.Genre.split(',').map((genre: string) => genre.trim()) || genres);
    setLanguage(omdbData?.Language || language);
  }, [omdbData]);

  const handleSeriesTitleSearch = async (title: string) => {
    try {
      const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
      setOmdbResults(omdbSearchResults);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Series title search failed.');
    }
  };

  const handleAddDirector = () => {
    setDirectors([...directors, { fullName: '', title: '' }]);
  };

  const handleDirectorChange = (index: number, field: keyof DirectorEntry, value: string) => {
    const newDirectors = [...directors];
    newDirectors[index][field] = value;
    setDirectors(newDirectors);
  };

  const handleSeriesSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
    setTitle(selectedTitle);
    const fullSeriesData = await retrieveMediaDataById(selectedImdbId);
    setOmdbData(fullSeriesData);
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
      countryOfOrigin: validateCountryOfOrigin(countryOfOrigin),
      directors: validateDirectors(directors.map(directorEntryToDirector)),
      imageFiles: validateImageFiles(imageFiles),
      runningDates: validateRunningDates(runningDates),
      runtime: validateRuntime(runtime),
      topCast: validateTopCast(topCast),
      writers: validateWriters(writers),
      seasons: validateSeasons(seasons),
      genres: validateGenres(genres),
      language: validateLanguage(language),
      regionCode: validateRegionCode(regionCode),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    const series: CatalogSeries = {
      id: '', // ID generated by the backend
      ...prepareTitleForStorage(title),
      countryOfOrigin: countryOfOrigin
        .split(',')
        .map((country) => country.trim())
        .filter(Boolean),
      directors: directors.map(directorEntryToDirector),
      imageFiles,
      letterboxdLink,
      plexLink,
      runningDates,
      releaseIds: [],
      runtime,
      topCast: topCast.map<CastEntry>((actorName) => ({ actorName })),
      writers,
      isPartOfCollection,
      collectionIds,
      seasons: seasons as CatalogSeries['seasons'],
      genres,
      languages: language
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      regionCode,
      externalIds: omdbData?.imdbID ? { imdbId: omdbData.imdbID } : undefined,
      totalSeasons: seasons.length,
      plot: omdbData?.Plot || undefined,
      contentRating: omdbData?.Rated || undefined,
      awards: omdbData?.Awards || undefined,
    };

    const service = new CatalogService('series');
    await service.addDocument(series);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Series</Typography>
        </Grid>
        <Grid size={12}>
          <FormSectionStack>
            <FormSection title="Search and Import" description="Search OMDB to auto-fill the form." titleTooltip="Search OMDB to pre-fill title, cast, runtime, artwork, and other metadata before reviewing it manually.">
              <Grid container spacing={2}>
                <Grid size={omdbData?.Poster ? 8 : 12}>
                  <Grid container spacing={2}>
                    <Grid size={9}>
                      <TextField
                        label={<FieldLabel label="Title" tooltip="Required. The official series title. Include a disambiguating year only when needed." />}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                        fullWidth
                        error={!!errors.title}
                        helperText={errors.title}
                      />
                    </Grid>
                    <Grid size={3}>
                      <Button onClick={() => handleSeriesTitleSearch(title)} variant="contained" color="primary">
                        Search
                      </Button>
                    </Grid>
                    {omdbResults.length > 0 && (
                      <Grid size={12}>
                        <List dense>
                          {omdbResults.map((result, index) => (
                            <ListItem key={`search-result-${index}`} disablePadding>
                              <ListItemButton onClick={() => handleSeriesSelect(result.Title, result.Year, result.imdbID)}>
                                <ListItemText primary={`${result.Title} (${result.Year})`} />
                              </ListItemButton>
                            </ListItem>
                          ))}
                        </List>
                      </Grid>
                    )}
                  </Grid>
                </Grid>
                {omdbData?.Poster && (
                  <Grid size={4}>
                    <Box
                      component="img"
                      src={omdbData.Poster}
                      alt={title}
                      sx={{ width: '100%', height: 'auto', borderRadius: 1 }}
                    />
                  </Grid>
                )}
              </Grid>
            </FormSection>

            <FormSection title="Core Details" description="Series dates, runtime and origin." titleTooltip="Enter the core identity and scheduling details for the series. Use broadcast dates and average runtime.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Running Dates" tooltip="Format: YYYY-YYYY or YYYY-. Example: 2011-2019 or 2019-." />}
                    value={runningDates}
                    onChange={(e) => setRunningDates(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.runningDates}
                    helperText={errors.runningDates}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Runtime" tooltip="Average episode runtime in h:mm:ss format. Example: 0:42:00." />}
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
                    label={<FieldLabel label="Country of Origin" tooltip="Comma-separated production countries. Example: United States, Canada." />}
                    value={countryOfOrigin}
                    onChange={(e) => setCountryOfOrigin(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.countryOfOrigin}
                    helperText={errors.countryOfOrigin}
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
                    label={<FieldLabel label="Is Part of Collection" tooltip="Enable when this series belongs to one or more curated collections." />}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Credits" description="Directors, cast and writers." titleTooltip="Store principal creative credits and recurring cast used throughout series-level views.">
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
                          label={<FieldLabel label="Title" tooltip="Optional role descriptor, such as Co-director or Episode Director." />}
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
                <Grid size={6}>
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
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Writers" tooltip="Comma-separated writer names credited for the series." />}
                    value={writers.join(', ')}
                    onChange={(e) => setWriters(e.target.value.split(', '))}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.writers}
                    helperText={errors.writers}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Classification" description="Genres and language metadata." titleTooltip="Set genre and language metadata that powers filtering and external metadata matching.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Genres" tooltip="Comma-separated genres, such as Drama, Sci-Fi, Thriller." />}
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
                    label={<FieldLabel label="Language" tooltip="Comma-separated spoken languages used in the series." />}
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

            <FormSection title="Seasons and Episodes" description="Add seasons and their episodes inline. Season and episode numbers must be unique." titleTooltip="Author nested season and episode structures in one flow, keeping season and episode numbering unique.">
              <NestedSeasonEditor
                seasons={seasons}
                onChange={setSeasons}
                error={errors.seasons}
              />
            </FormSection>

            <FormSection title="Links and Media" description="External links and artwork." titleTooltip="Optional external URLs and artwork used for this series record.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Letterboxd Link" tooltip="Optional URL to the series page on Letterboxd or similar tracking site." />}
                    value={letterboxdLink}
                    onChange={(e) => setLetterboxdLink(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Plex Link" tooltip="Optional URL to this series in your Plex library." />}
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
            label="Add Series"
            onClick={handleSubmit}
            disabled={!omdbData} />
        </Grid>
      </Grid>
    </form>
  );
};

export default SeriesForm;