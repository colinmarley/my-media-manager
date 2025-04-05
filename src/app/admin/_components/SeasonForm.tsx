import React, { useState, useEffect } from 'react';
import Grid from '@mui/material/Grid2';
import Box from '@mui/material/Box';
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
import { FBSeason, Episode } from '../../../types/firebase/FBSeason.type';
import { Director, DirectorEntry, ImageFile } from '../../../types/firebase/FBCommon.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '../../../service/omdb/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useSeasonValidation from '../../../utils/useSeasonValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';

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

const FormTextField = (props: { label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, error?: string | null }) => (
  <TextField
    label={props.label}
    value={props.value}
    onChange={props.onChange}
    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
    fullWidth
    required
    error={!!props.error}
    helperText={props.error}
  />
);

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
  const [releases, setReleases] = useState<string[]>([]);
  const [runtime, setRuntime] = useState('');
  const [topCast, setTopCast] = useState<string[]>([]);
  const [writers, setWriters] = useState<string[]>([]);
  const [isPartOfCollection, setIsPartOfCollection] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
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
    setDirectors(omdbData?.Director.split(',').map((director: string) => ({ name: director, title: '' })).concat(directors) || directors);
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
    const omdbSearchResults: OmdbSearchResponse[] = await searchByText(title);
    setOmdbResults(omdbSearchResults);
  };

  const handleAddDirector = () => {
    setDirectors([...directors, { name: '', title: '' }]);
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

  const directorEntryToDirector = (entry: DirectorEntry): Director => {
    return {
      name: entry.name,
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

    const season: FBSeason = {
      id: '', // Firebase will generate the ID
      title,
      seriesId,
      number,
      countryOfOrigin,
      directors: directors.map(directorEntryToDirector),
      imageFiles,
      letterboxdLink,
      plexLink,
      omdbData: omdbData!,
      releaseDate,
      releases: [], // Assuming releases are an array of release IDs
      runtime,
      topCast,
      writers,
      isPartOfCollection,
      collectionIds,
      episodes,
      genres,
      language,
      regionCode,
    };

    const service = new FirestoreService('seasons');
    await service.addDocument(season);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Season</Typography>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        </Grid>
        <Grid size={12}>
          <Button onClick={() => handleSeasonTitleSearch(title)} variant="contained" color="primary">
            Search Season Title
          </Button>
        </Grid>
        {omdbResults.length > 0 && (
          <Grid size={12}>
            <Typography variant="h6">Search Results:</Typography>
            <List>
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
        <Grid size={12}>
          <FormTextField label="Series ID" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} error={errors.seriesId} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Number" value={number.toString()} onChange={(e) => setNumber(parseInt(e.target.value))} error={errors.number} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Country of Origin" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} error={errors.countryOfOrigin} />
        </Grid>
        <Grid size={12}>
          <Typography variant="h6">Directors</Typography>
          {directors.map((director, index) => (
            <Grid container spacing={2} key={index}>
              <Grid size={6}>
                <FormTextField
                  label="Name"
                  value={director.name}
                  onChange={(e) => handleDirectorChange(index, 'name', e.target.value)}
                />
              </Grid>
              <Grid size={6}>
                <FormTextField
                  label="Title"
                  value={director.title}
                  onChange={(e) => handleDirectorChange(index, 'title', e.target.value)}
                />
              </Grid>
            </Grid>
          ))}
          <Button onClick={handleAddDirector}>Add Director</Button>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Letterboxd Link" value={letterboxdLink} onChange={(e) => setLetterboxdLink(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Plex Link" value={plexLink} onChange={(e) => setPlexLink(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Release Date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} error={errors.releaseDate} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Releases" value={releases.join(', ')} onChange={(e) => setReleases(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} error={errors.runtime} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Top Cast" value={topCast.join(', ')} onChange={(e) => setTopCast(e.target.value.split(', '))} error={errors.topCast} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Writers" value={writers.join(', ')} onChange={(e) => setWriters(e.target.value.split(', '))} error={errors.writers} />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={isPartOfCollection}
                onChange={(e) => setIsPartOfCollection(e.target.checked)}
              />
            }
            label="Is Part of Collection"
          />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Collection IDs" value={collectionIds.join(', ')} onChange={(e) => setCollectionIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} error={errors.genres} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} error={errors.language} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Region Code" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} error={errors.regionCode} />
        </Grid>
        <Grid size={12}>
          <ImageSearch />
        </Grid>
        <Grid size={12}>
          <SubmitButton
            label="Add Season"
            onClick={handleSubmit}
            disabled={!omdbData} />
        </Grid>
        {omdbData && (
          <Grid size={12}>
            <Typography variant="body1">OMDB Data: {JSON.stringify(omdbData)}</Typography>
          </Grid>
        )}
      </Grid>
    </form>
  );
};

export default SeasonForm;