import React, { useState } from 'react';
import { TextField, Button, Typography, FormControl, FormControlLabel, Checkbox } from '@mui/material';
import FirestoreService from '../../../service/FirestoreService';
import { FBCollection } from '../../../types/firebase/FBCollection.type';
import { DirectorEntry, ImageFile } from '../../../types/firebase/FBCommon.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import Grid from '@mui/material/Grid2';
import styles from '../_styles/MovieForm.module.css';

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

const CollectionForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [directors, setDirectors] = useState<DirectorEntry[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [movieIds, setMovieIds] = useState<string[]>([]);
  const [seriesIds, setSeriesIds] = useState<string[]>([]);
  const [seasonIds, setSeasonIds] = useState<string[]>([]);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);

  const handleAddDirector = () => {
    setDirectors([...directors, { name: '', title: '' }]);
  };

  const handleDirectorChange = (index: number, field: keyof DirectorEntry, value: string) => {
    const newDirectors = [...directors];
    newDirectors[index][field] = value;
    setDirectors(newDirectors);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const collection: FBCollection = {
      id: '', // Firebase will generate the ID
      title,
      description,
      imageFiles,
      movieIds: movieIds.map(id => ({ id })),
      seriesIds: seriesIds.map(id => ({ id })),
      seasonIds: seasonIds.map(id => ({ id })),
      episodeIds: episodeIds.map(id => ({ id })),
      directors,
      genres,
    };

    const service = new FirestoreService('collections');
    await service.addDocument(collection);
  };

  return (
    <FormControl
        onSubmit={handleSubmit}
        className={styles.root}
        color="secondary">
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Collection</Typography>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ input: { color: 'white' }, label: { color: 'white' } }}
            fullWidth
            multiline
            rows={4}
            required
          />
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
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Movie IDs" value={movieIds.join(', ')} onChange={(e) => setMovieIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Series IDs" value={seriesIds.join(', ')} onChange={(e) => setSeriesIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Season IDs" value={seasonIds.join(', ')} onChange={(e) => setSeasonIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Episode IDs" value={episodeIds.join(', ')} onChange={(e) => setEpisodeIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <ImageSearch />
        </Grid>
        <Grid size={12}>
          <Button type="submit" variant="contained" color="primary">
            Add Collection
          </Button>
        </Grid>
      </Grid>
    </FormControl>
  );
};

export default CollectionForm;