import React, { useState } from 'react';
import { TextField, Button, Typography } from '@mui/material';
import FirestoreService from '../../../service/firebase/FirestoreService';
import { FBCollection } from '../../../types/firebase/FBCollection.type';
import { ImageFile } from '../../../types/firebase/FBCommon.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import Grid from '@mui/material/Grid';
import useCollectionValidation from '../../../utils/useCollectionValidation';
import styles from '../_styles/Form.module.css';
import SubmitButton from '@/app/_components/SubmitButton';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';

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

const CollectionForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
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
      entryCount: movieIds.length + seriesIds.length + seasonIds.length + episodeIds.length,
    };

    const service = new FirestoreService('collections');
    await service.addDocument(collection);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Collection</Typography>
        </Grid>
        <Grid size={12}>
          <FormSectionStack>
            <FormSection title="Identity" description="Collection title and key identifiers." titleTooltip="Use this section to define what the collection is called and how it should be identified in the app.">
              <TextField
                label={<FieldLabel label="Title" tooltip="Required. A descriptive name such as Christopher Nolan Filmography or MCU Phase 1." />}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                fullWidth
                error={!!errors.title}
                helperText={errors.title}
              />
            </FormSection>

            <FormSection title="Overview" description="An overview or summary of the collection." titleTooltip="Describe what qualifies an item for inclusion and what the collection represents.">
              <TextField
                label={<FieldLabel label="Description" tooltip="A short explanation of the collection and how its entries are curated." />}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                sx={{ label: { color: 'white' } }}
                fullWidth
                multiline
                rows={4}
                error={!!errors.description}
                helperText={errors.description}
              />
            </FormSection>

            <FormSection title="Classification and Credits" description="Genres and directing credits." titleTooltip="Classify the collection and list key credited directors represented in this set.">
              <Grid container spacing={2}>
                <Grid size={12}>
                  <TextField
                    label={<FieldLabel label="Genres" tooltip="Comma-separated genres that describe the collection as a whole." />}
                    value={genres.join(', ')}
                    onChange={(e) => setGenres(e.target.value ? e.target.value.split(', ') : [])}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="Comma-separated genres"
                    error={!!errors.genres}
                    helperText={errors.genres}
                  />
                </Grid>
                <Grid size={12}>
                  <Typography variant="subtitle2" color="rgba(255,255,255,0.7)" sx={{ mb: 1 }}>Directors</Typography>
                  {directors.map((director, index) => (
                    <Grid container spacing={1} key={index} sx={{ mb: 1 }}>
                      <Grid size={10}>
                        <TextField
                          label={<FieldLabel label={`Director ${index + 1}`} tooltip="A director whose work is featured in this collection." />}
                          value={director}
                          onChange={(e) => {
                            const updated = [...directors];
                            updated[index] = e.target.value;
                            setDirectors(updated);
                          }}
                          size="small"
                          fullWidth
                          sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                          error={!!errors.directors}
                          helperText={index === 0 ? errors.directors : undefined}
                        />
                      </Grid>
                      <Grid size={2}>
                        <Button
                          onClick={() => setDirectors(directors.filter((_, i) => i !== index))}
                          color="error"
                          size="small"
                          variant="outlined"
                        >
                          Remove
                        </Button>
                      </Grid>
                    </Grid>
                  ))}
                  <Button
                    onClick={() => setDirectors([...directors, ''])}
                    size="small"
                    data-testid="add-director-btn"
                  >
                    Add Director
                  </Button>
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Included Entries" description="Movies, series, seasons and episodes in this collection." titleTooltip="Link existing media records by Firestore ID. These IDs determine what appears inside the collection.">
              <Grid container spacing={2}>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Movie IDs" tooltip="Comma-separated Firestore movie document IDs included in this collection." />}
                    value={movieIds.join(', ')}
                    onChange={(e) => setMovieIds(e.target.value ? e.target.value.split(', ') : [])}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="Comma-separated IDs"
                    error={!!errors.movieIds}
                    helperText={errors.movieIds}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Series IDs" tooltip="Comma-separated Firestore series document IDs included in this collection." />}
                    value={seriesIds.join(', ')}
                    onChange={(e) => setSeriesIds(e.target.value ? e.target.value.split(', ') : [])}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="Comma-separated IDs"
                    error={!!errors.seriesIds}
                    helperText={errors.seriesIds}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Season IDs" tooltip="Comma-separated Firestore season document IDs included in this collection." />}
                    value={seasonIds.join(', ')}
                    onChange={(e) => setSeasonIds(e.target.value ? e.target.value.split(', ') : [])}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="Comma-separated IDs"
                    error={!!errors.seasonIds}
                    helperText={errors.seasonIds}
                  />
                </Grid>
                <Grid size={6}>
                  <TextField
                    label={<FieldLabel label="Episode IDs" tooltip="Comma-separated Firestore episode document IDs included in this collection." />}
                    value={episodeIds.join(', ')}
                    onChange={(e) => setEpisodeIds(e.target.value ? e.target.value.split(', ') : [])}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    fullWidth
                    placeholder="Comma-separated IDs"
                    error={!!errors.episodeIds}
                    helperText={errors.episodeIds}
                  />
                </Grid>
              </Grid>
            </FormSection>

            <FormSection title="Media Assets" description="Images associated with this collection." titleTooltip="Attach artwork used for collection cards, headers, and detail views.">
              <ImageSearch />
            </FormSection>
          </FormSectionStack>
        </Grid>
        <Grid size={3}>
          <SubmitButton
            label="Add Collection"
            onClick={handleSubmit} />
        </Grid>
      </Grid>
    </form>
  );
};

export default CollectionForm;