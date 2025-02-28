import React, { useState, useEffect } from 'react';
import { TextField, Button, Grid, Typography, FormControl, FormControlLabel, Checkbox, List, ListItem, ListItemText, ListItemButton } from '@mui/material';
import FirestoreService from '../../../service/FirestoreService';
import { FBEpisode } from '../../../types/firebase/FBEpisode.type';
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

  const handleEpisodeTitleSearch = async (title: string) => {
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

  const handleEpisodeSelect = async (selectedTitle: string, selectedYear: string, selectedImdbId: string) => {
    setTitle(selectedTitle);
    const fullEpisodeData = await retrieveMediaDataById(selectedImdbId);
    setOmdbData(fullEpisodeData);
    setOmdbResults([]); // Clear the search results after selection
  };

  const directorEntryToDirector = (director: DirectorEntry): Director => {
    return {
      name: director.name,
      notes: '',
      portfolio: [],
      otherCollections: [],
      awards: [],
    };
  }; 


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const episode: FBEpisode = {
      id: '', // Firebase will generate the ID
      title,
      seasonId,
      seriesId,
      episodeNumber,
      notes,
      countryOfOrigin,
      directors: directors.map(director => directorEntryToDirector(director)),
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
        <Grid item xs={12}>
          <Typography variant="h4" color="white">Add New Episode</Typography>
        </Grid>
        <Grid item xs={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <Button onClick={() => handleEpisodeTitleSearch(title)} variant="contained" color="primary">
            Search Episode Title
          </Button>
        </Grid>
        {omdbResults.length > 0 && (
          <Grid item xs={12}>
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
        <Grid item xs={12}>
          <FormTextField label="Season ID" value={seasonId} onChange={(e) => setSeasonId(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <FormTextField label="Series ID" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <FormTextField label="Episode Number" value={episodeNumber} onChange={(e) => setEpisodeNumber(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <FormTextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <FormTextField label="Country of Origin" value={countryOfOrigin} onChange={(e) => setCountryOfOrigin(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <Typography variant="h6">Directors</Typography>
          {directors.map((director, index) => (
            <Grid container spacing={2} key={index}>
              <Grid item xs={6}>
                <FormTextField
                  label="Name"
                  value={director.name}
                  onChange={(e) => handleDirectorChange(index, 'name', e.target.value)}
                />
              </Grid>
              <Grid item xs={6}>
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
        <Grid item xs={6}>
          <FormTextField label="Letterboxd Link" value={letterboxdLink} onChange={(e) => setLetterboxdLink(e.target.value)} />
        </Grid>
        <Grid item xs={6}>
          <FormTextField label="Plex Link" value={plexLink} onChange={(e) => setPlexLink(e.target.value)} />
        </Grid>
        <Grid item xs={3}>
          <FormTextField label="Release Date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
        </Grid>
        <Grid item xs={3}>
          <FormTextField label="Runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
        </Grid>
        <Grid item xs={6}>
          <FormTextField label="Top Cast" value={topCast.join(', ')} onChange={(e) => setTopCast(e.target.value.split(', '))} />
        </Grid>
        <Grid item xs={6}>
          <FormTextField label="Writers" value={writers.join(', ')} onChange={(e) => setWriters(e.target.value.split(', '))} />
        </Grid>
        <Grid item xs={6}>
          <FormTextField label="Actors" value={actors.join(', ')} onChange={(e) => setActors(e.target.value.split(', '))} />
        </Grid>
        <Grid item xs={6}>
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
        <Grid item xs={4}>
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} />
        </Grid>
        <Grid item xs={8}>
          <FormTextField label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </Grid>
        <Grid item xs={12}>
          <ImageSearch />
        </Grid>
        <Grid item xs={3}>
          <Button type="submit" variant="contained" color="primary" onClick={handleSubmit} disabled={!omdbData}>
            Add Episode
          </Button>
        </Grid>
        {omdbData && (
          <Grid item xs={12}>
            <Typography variant="body1">OMDB Data: {JSON.stringify(omdbData)}</Typography>
          </Grid>
        )}
      </Grid>
    </form>
  );
};

export default EpisodeForm;