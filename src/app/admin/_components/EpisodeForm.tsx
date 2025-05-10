import React, { useState, useEffect } from 'react';
import Grid from '@mui/material/Grid2';
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
import { DirectorEntry, ImageFile } from '../../../types/firebase/FBCommon.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '@/service/omdb/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useEpisodeValidation from '../../../utils/useEpisodeValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';

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
  const [releases, setReleases] = useState<string[]>([]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = {
      title: validateTitle(title),
      seasonId: validateSeasonId(seasonId),
      seriesId: validateSeriesId(seriesId),
      episodeNumber: validateEpisodeNumber(episodeNumber),
      countryOfOrigin: validateCountryOfOrigin(countryOfOrigin),
      directors: validateDirectors(directors),
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

    const episode: FBEpisode = {
      id: '', // Firebase will generate the ID
      title,
      seasonId,
      seriesId,
      episodeNumber,
      notes,
      countryOfOrigin,
      directors: directors,
      imageFiles,
      letterboxdLink,
      plexLink,
      omdbData: omdbData!,
      releaseDate,
      releases: [], // Assuming releases are an array of release IDs
      runtime,
      topCast,
      writers,
      actors,
      isPartOfCollection,
      collectionIds,
      genres,
      language,
      regionCode,
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
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        </Grid>
        <Grid size={12}>
          <Button onClick={() => handleEpisodeTitleSearch(title)} variant="contained" color="primary">
            Search Episode Title
          </Button>
        </Grid>
        {omdbResults.length > 0 && (
          <Grid size={12}>
            <Typography variant="h6">Search Results:</Typography>
            <List>
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
        <Grid size={12}>
          <FormTextField label="Season ID" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} error={errors.seasonId} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Series ID" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} error={errors.seriesId} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Episode Number" value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} error={errors.episodeNumber} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
                  value={director.fullName}
                  onChange={(e) => handleDirectorChange(index, 'fullName', e.target.value)}
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
        <Grid size={6}>
          <FormTextField label="Letterboxd Link" value={letterboxdLink} onChange={(e) => setLetterboxdLink(e.target.value)} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Plex Link" value={plexLink} onChange={(e) => setPlexLink(e.target.value)} />
        </Grid>
        <Grid size={3}>
          <FormTextField label="Release Date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} error={errors.releaseDate} />
        </Grid>
        <Grid size={3}>
          <FormTextField label="Runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} error={errors.runtime} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Top Cast" value={topCast.join(', ')} onChange={(e) => setTopCast(e.target.value.split(', '))} error={errors.topCast} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Writers" value={writers.join(', ')} onChange={(e) => setWriters(e.target.value.split(', '))} error={errors.writers} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Actors" value={actors.join(', ')} onChange={(e) => setActors(e.target.value.split(', '))} error={errors.actors} />
        </Grid>
        <Grid size={6}>
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
        <Grid size={4}>
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} error={errors.genres} />
        </Grid>
        <Grid size={8}>
          <FormTextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} error={errors.language} />
        </Grid>
        <Grid size={12}>
          <ImageSearch />
        </Grid>
        <Grid size={3}>
          <SubmitButton
            label={'Add Episode'}
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

export default EpisodeForm;