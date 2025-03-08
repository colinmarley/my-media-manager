import React, { useState } from 'react';
import { TextField, Button, Typography, FormControl, FormControlLabel, Checkbox } from '@mui/material';
import FirestoreService from '../../../service/FirestoreService';
import { FBCollection } from '../../../types/firebase/FBCollection.type';
import { DirectorEntry, ImageFile } from '../../../types/firebase/FBCommon.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import Grid from '@mui/material/Grid2';
import useCollectionValidation from '../../../utils/useCollectionValidation';
import styles from '../_styles/MovieForm.module.css';

interface CollectionValidation {
  title: string | null;
  description: string | null;
  imageFiles: string | null;
  directors: string | null;
  genres: string | null;
  movieIds: string | null;
  seriesIds: string | null;
  seasonIds: string | null;
  episodeIds: string | null;
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

const CollectionForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageFiles, setImageFiles] = useState<string[]>([]);
  const [directors, setDirectors] = useState<string[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [movieIds, setMovieIds] = useState<string[]>([]);
  const [seriesIds, setSeriesIds] = useState<string[]>([]);
  const [seasonIds, setSeasonIds] = useState<string[]>([]);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);

  const {
    validateTitle,
    validateDescription,
    validateImageFiles,
    validateDirectors,
    validateGenres,
    validateMovieIds,
    validateSeriesIds,
    validateSeasonIds,
    validateEpisodeIds,
  } = useCollectionValidation();

  const [errors, setErrors] = useState<CollectionValidation>({
    title: null,
    description: null,
    imageFiles: null,
    directors: null,
    genres: null,
    movieIds: null,
    seriesIds: null,
    seasonIds: null,
    episodeIds: null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = {
      title: validateTitle(title),
      description: validateDescription(description),
      imageFiles: validateImageFiles(imageFiles),
      directors: validateDirectors(directors),
      genres: validateGenres(genres),
      movieIds: validateMovieIds(movieIds),
      seriesIds: validateSeriesIds(seriesIds),
      seasonIds: validateSeasonIds(seasonIds),
      episodeIds: validateEpisodeIds(episodeIds),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    const collection: FBCollection = {
      id: '', // Firebase will generate the ID
      title,
      description,
      imageFiles,
      movieIds,
      seriesIds,
      seasonIds,
      episodeIds,
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
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
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
            error={!!errors.description}
            helperText={errors.description}
          />
        </Grid>
        <Grid size={12}>
          <Typography variant="h6">Directors</Typography>
          {directors.map((director, index) => (
            <Grid container spacing={2} key={index}>
              <Grid size={6}>
                <FormTextField
                  label="Name"
                  value={director}
                  onChange={(e) => {
                    const newDirectors = [...directors];
                    newDirectors[index] = e.target.value;
                    setDirectors(newDirectors);
                  }}
                />
              </Grid>
            </Grid>
          ))}
          <Button onClick={() => setDirectors([...directors, ''])}>Add Director</Button>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Genres" value={genres.join(', ')} onChange={(e) => setGenres(e.target.value.split(', '))} error={errors.genres} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Movie IDs" value={movieIds.join(', ')} onChange={(e) => setMovieIds(e.target.value.split(', '))} error={errors.movieIds} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Series IDs" value={seriesIds.join(', ')} onChange={(e) => setSeriesIds(e.target.value.split(', '))} error={errors.seriesIds} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Season IDs" value={seasonIds.join(', ')} onChange={(e) => setSeasonIds(e.target.value.split(', '))} error={errors.seasonIds} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Episode IDs" value={episodeIds.join(', ')} onChange={(e) => setEpisodeIds(e.target.value.split(', '))} error={errors.episodeIds} />
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