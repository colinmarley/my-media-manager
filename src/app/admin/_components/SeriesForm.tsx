import React, { useState, useEffect } from 'react';
import { TextField, Button, Typography, FormControl, FormControlLabel, Checkbox, List, ListItem, ListItemText, ListItemButton } from '@mui/material';
import Grid from '@mui/material/Grid2';
import FirestoreService from '../../../service/FirestoreService';
import { FBSeries, Season, Episode } from '../../../types/firebase/FBSeries.type';
import { Director, DirectorEntry, ImageFile } from '../../../types/firebase/FBCommon.type';
import { OmdbResponseFull, OmdbSearchResponse } from '../../../types/OmdbResponse.type';
import { searchByText, retrieveMediaDataById } from '../../../service/OmdbService';
import ImageSearch from '../imageManager/_components/ImageSearch';
import styles from '../_styles/Form.module.css';

const FormTextField = (props: { label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) => (
  <TextField
    label={props.label}
    value={props.value}
    onChange={props.onChange}
    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
    fullWidth
    required
  />
);

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
  const [releases, setReleases] = useState<string[]>([]);
  const [runtime, setRuntime] = useState('');
  const [topCast, setTopCast] = useState<string[]>([]);
  const [writers, setWriters] = useState<string[]>([]);
  const [isPartOfCollection, setIsPartOfCollection] = useState(false);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [language, setLanguage] = useState('');
  const [regionCode, setRegionCode] = useState('');

  useEffect(() => {
    setTitle(omdbData?.Title || title);
    setCountryOfOrigin(omdbData?.Country || countryOfOrigin);
    setDirectors(omdbData?.Director.split(',').map((director: string) => ({ name: director, title: '' })).concat(directors) || directors);
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

  const handleSeriesSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
    setTitle(selectedTitle);
    const fullSeriesData = await retrieveMediaDataById(selectedImdbId);
    setOmdbData(fullSeriesData);
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

    const series: FBSeries = {
      id: '', // Firebase will generate the ID
      title,
      countryOfOrigin,
      directors: directors.map(director => directorEntryToDirector(director)),
      imageFiles,
      letterboxdLink,
      plexLink,
      omdbData: omdbData!,
      runningDates,
      releases: [], // Assuming releases are an array of release IDs
      runtime,
      topCast,
      writers,
      isPartOfCollection,
      collectionIds,
      seasons,
      genres,
      language,
      regionCode,
    };

    const service = new FirestoreService('series');
    await service.addDocument(series);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Series</Typography>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <Button onClick={() => handleSeriesTitleSearch(title)} variant="contained" color="primary">
            Search Series Title
          </Button>
        </Grid>
        {omdbResults.length > 0 && (
          <Grid size={12}>
            <Typography variant="h6">Search Results:</Typography>
            <List>
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
        <Grid size={12}>
          <FormTextField label="Country of Origin" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} />
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
        <Grid size={6}>
          <FormTextField label="Letterboxd Link" value={letterboxdLink} onChange={(e) => setLetterboxdLink(e.target.value)} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Plex Link" value={plexLink} onChange={(e) => setPlexLink(e.target.value)} />
        </Grid>
        <Grid size={3}>
          <FormTextField label="Running Dates" value={runningDates} onChange={(e) => setRunningDates(e.target.value)} />
        </Grid>
        <Grid size={3}>
          <FormTextField label="Runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Top Cast" value={topCast.join(', ')} onChange={(e) => setTopCast(e.target.value.split(', '))} />
        </Grid>
        <Grid size={6}>
          <FormTextField label="Writers" value={writers.join(', ')} onChange={(e) => setWriters(e.target.value.split(', '))} />
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
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} />
        </Grid>
        <Grid size={8}>
          <FormTextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <ImageSearch />
        </Grid>
        <Grid size={3}>
          <Button type="submit" variant="contained" color="primary" onClick={handleSubmit} disabled={!omdbData}>
            Add Series
          </Button>
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

export default SeriesForm;