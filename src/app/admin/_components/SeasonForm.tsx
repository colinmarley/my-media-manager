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
import CatalogService from '../../../service/catalog/CatalogService';
import { CatalogSeason } from '../../../types/catalog/Season.type';
import { CastEntry, DirectorEntry, DirectorReference, ImageFile } from '../../../types/catalog/Common.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '@/service/omdb/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useSeasonValidation from '../../../utils/useSeasonValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';
import { prepareTitleForStorage } from '../../../utils/titleUtils';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';
import { NestedEpisodeEditor, EpisodeEntry } from './forms/editors';

interface SeasonValidation {
  title: string | null;
  seriesId: string | null;
  number: string | null;
  countryOfOrigin: string | null;
  directors: string | null;
  imageFiles: string | null;
  releaseDate: string | null;
  runtime: string | null;
  topCast: string | null;
  writers: string | null;
  episodes: string | null;
  language: string | null;
  regionCode: string | null;
  genres: string | null;
}

const SeasonForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [number, setNumber] = useState(0);
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
  const [isPartOfCollection, setIsPartOfCollection] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeEntry[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [regionCode, setRegionCode] = useState('');

  const {
    validateTitle,
    validateSeriesId,
    validateNumber,
    validateCountryOfOrigin,
    validateDirectors,
    validateImageFiles,
    validateReleaseDate,
    validateRuntime,
    validateTopCast,
    validateWriters,
    validateEpisodes,
    validateGenres,
    validateLanguage,
    validateRegionCode,
  } = useSeasonValidation();

  const [errors, setErrors] = useState<SeasonValidation>({
    title: null,
    seriesId: null,
    number: null,
    countryOfOrigin: null,
    directors: null,
    imageFiles: null,
    releaseDate: null,
    runtime: null,
    topCast: null,
    writers: null,
    episodes: null,
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
    setReleaseDate(omdbData?.Released || releaseDate);
    setRuntime(omdbData?.Runtime || runtime);
    setTopCast(omdbData?.Actors.split(',').map((actor: string) => actor.trim()) || topCast);
    setWriters(omdbData?.Writer.split(',').map((writer: string) => writer.trim()) || writers);
    setGenres(omdbData?.Genre.split(',').map((genre: string) => genre.trim()) || genres);
    setLanguage(omdbData?.Language || language);
  }, [omdbData]);

  const handleSeasonTitleSearch = async (title: string) => {
    try {
      const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
      setOmdbResults(omdbSearchResults);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Season title search failed.');
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

  const handleSeasonSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
    setTitle(selectedTitle);
    const fullSeasonData = await retrieveMediaDataById(selectedImdbId);
    setOmdbData(fullSeasonData);
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
      seriesId: validateSeriesId(seriesId),
      number: validateNumber(number),
      countryOfOrigin: validateCountryOfOrigin(countryOfOrigin),
      directors: validateDirectors(directors.map(directorEntryToDirector)),
      imageFiles: validateImageFiles(imageFiles),
      releaseDate: validateReleaseDate(releaseDate),
      runtime: validateRuntime(runtime),
      topCast: validateTopCast(topCast),
      writers: validateWriters(writers),
      episodes: validateEpisodes(episodes),
      genres: validateGenres(genres),
      language: validateLanguage(language),
      regionCode: validateRegionCode(regionCode),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    const season: CatalogSeason = {
      id: '', // ID generated by the backend
      ...prepareTitleForStorage(title),
      seriesId,
      number,
      countryOfOrigin: countryOfOrigin
        .split(',')
        .map((country) => country.trim())
        .filter(Boolean),
      directors: directors.map(directorEntryToDirector),
      imageFiles,
      letterboxdLink,
      plexLink,
      releaseDate,
      releaseIds: [],
      runtime,
      topCast: topCast.map<CastEntry>((actorName) => ({ actorName })),
      writers,
      isPartOfCollection,
      collectionIds,
      episodes: episodes as CatalogSeason['episodes'],
      genres,
      languages: language
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      regionCode,
      externalIds: omdbData?.imdbID ? { imdbId: omdbData.imdbID } : undefined,
      plot: omdbData?.Plot || undefined,
      episodeCount: episodes.length,
      posterUrl: omdbData?.Poster || undefined,
    };

    const service = new CatalogService('seasons');
    await service.addDocument(season);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Season</Typography>
        </Grid>
        <Grid size={12}>
          <FormSectionStack>
            <FormSection title="Parent Selection" description="Link this season to its parent series." titleTooltip="A season must always point to its parent series document. Use the catalog series document ID.">
              <TextField
                label={<FieldLabel label="Series ID" tooltip="Required. The catalog document ID of the parent series." />}
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                fullWidth
                error={!!errors.seriesId}
                helperText={errors.seriesId}
              />
            </FormSection>

            <FormSection title="Core Details" description="Season identity and dates." titleTooltip="Enter the season number, title, premiere date, and runtime details for this season.">
              <Grid container spacing={2}>
                <Grid size={9}>
                  <TextField
                    label={<FieldLabel label="Title" tooltip="Required. Official season title as displayed to users." />}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.title}
                    helperText={errors.title}
                  />
                </Grid>
                <Grid size={3}>
                  <Button onClick={() => handleSeasonTitleSearch(title)} variant="contained" color="primary">
                    Search
                  </Button>
                </Grid>
                {omdbResults.length > 0 && (
                  <Grid size={12}>
                    <List dense>
                      {omdbResults.map((result, index) => (
                        <ListItem key={`search-result-${index}`} disablePadding>
                          <ListItemButton onClick={() => handleSeasonSelect(result.Title, result.Year, result.imdbID)}>
                            <ListItemText primary={`${result.Title} (${result.Year})`} />
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}
                <Grid size={3}>
                  <TextField
                    label={<FieldLabel label="Season Number" tooltip="Numeric season order within the parent series." />}
                    type="number"
                    value={number}
                    onChange={(e) => setNumber(parseInt(e.target.value) || 0)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    error={!!errors.number}
                    helperText={errors.number}
                  />
                </Grid>
                <Grid size={4}>
                  <TextField
                    label={<FieldLabel label="Release Date" tooltip="Season premiere date in YYYY-MM-DD format when available." />}
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
                    label={<FieldLabel label="Runtime" tooltip="Typical episode runtime for this season in h:mm:ss format." />}
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
                    label={<FieldLabel label="Country of Origin" tooltip="Comma-separated production countries for this season." />}
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
                    label={<FieldLabel label="Is Part of Collection" tooltip="Enable when this season belongs to one or more curated collections." />}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Credits" description="Directors, cast and writers." titleTooltip="Capture key creative and performer credits for this season-level record.">
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
                          label={<FieldLabel label="Title" tooltip="Optional role descriptor, such as Co-director or Unit Director." />}
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
                    label={<FieldLabel label="Top Cast" tooltip="Comma-separated principal cast names for this season." />}
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
                    label={<FieldLabel label="Writers" tooltip="Comma-separated writer names credited for this season." />}
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

            <FormSection title="Classification" description="Genres and language metadata." titleTooltip="Set genre and language attributes to keep search and filtering consistent across the library.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Genres" tooltip="Comma-separated genres for this season." />}
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
                    label={<FieldLabel label="Language" tooltip="Comma-separated spoken languages used in this season." />}
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

            <FormSection title="Episodes" description="Add episodes for this season. Episode numbers must be unique." titleTooltip="Define episode order and metadata directly here. Avoid duplicate episode numbers within the same season.">
              <NestedEpisodeEditor
                episodes={episodes}
                onChange={setEpisodes}
                error={errors.episodes}
              />
            </FormSection>

            <FormSection title="Links and Media" description="External links and imagery." titleTooltip="Optional links and artwork references associated with this season.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Letterboxd Link" tooltip="Optional URL to a season page on Letterboxd or similar tracking site." />}
                    value={letterboxdLink}
                    onChange={(e) => setLetterboxdLink(e.target.value)}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Plex Link" tooltip="Optional URL to this season in your Plex library." />}
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
            label="Add Season"
            onClick={handleSubmit}
            disabled={!omdbData} />
        </Grid>
      </Grid>
    </form>
  );
};

export default SeasonForm;