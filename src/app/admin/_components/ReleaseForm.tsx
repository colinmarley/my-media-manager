import React, { useState } from 'react';
import { Button, Checkbox, FormControl, FormControlLabel, TextField, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import FirestoreService from '../../../service/FirestoreService';
import { FBRelease, ImageFile, Extra } from '../../../types/firebase/FBRelease.type';
import useReleaseValidation from '../../../utils/useReleaseValidation';
import styles from '../_styles/MovieForm.module.css';

interface ReleaseValidation {
    title: string | null;
    year: string | null;
    discIds: string | null;
    discTypes: string | null;
    extras: string | null;
    mediaType: string | null;
    images: string | null;
}

const FormTextField = (
  props: { 
    label: string,
    value: string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
    error?: string | null
  }) => (
    <TextField
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      sx={{input: { color: 'white' }, label: { color: 'white' }}}
      fullWidth
      required
      error={!!props.error}
      helperText={props.error}
    />
);

const ReleaseForm: React.FC = () => {
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [containsExtras, setContainsExtras] = useState(false);
  const [containsInserts, setContainsInserts] = useState(false);
  const [discIds, setDiscIds] = useState<string[]>([]);
  const [discTypes, setDiscTypes] = useState<string[]>([]);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [mediaType, setMediaType] = useState('');
  const [movieIds, setMovieIds] = useState<string[]>([]);
  const [seasonIds, setSeasonIds] = useState<string[]>([]);
  const [seriesIds, setSeriesIds] = useState<string[]>([]);
  const [images, setImages] = useState<ImageFile[]>([]);

  const {
    validateTitle,
    validateYear,
    validateDiscIds,
    validateDiscTypes,
    validateExtras,
    validateMediaType,
    validateImages,
  } = useReleaseValidation();

  const [errors, setErrors] = useState<ReleaseValidation>({
    title: null,
    year: null,
    discIds: null,
    discTypes: null,
    extras: null,
    mediaType: null,
    images: null,
  });

  const handleAddDiscId = () => {
    setDiscIds([...discIds, '']);
  };

  const handleDiscIdChange = (index: number, value: string) => {
    const newDiscIds = [...discIds];
    newDiscIds[index] = value;
    setDiscIds(newDiscIds);
  };

  const handleAddDiscType = () => {
    setDiscTypes([...discTypes, '']);
  };

  const handleDiscTypeChange = (index: number, value: string) => {
    const newDiscTypes = [...discTypes];
    newDiscTypes[index] = value;
    setDiscTypes(newDiscTypes);
  };

  const handleAddExtra = () => {
    setExtras([...extras, { runtime: '', title: '', type: '' }]);
  };

  const handleExtraChange = (index: number, field: keyof Extra, value: string) => {
    const newExtras = [...extras];
    newExtras[index][field] = value;
    setExtras(newExtras);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = {
      title: validateTitle(title),
      year: validateYear(year),
      discIds: validateDiscIds(discIds),
      discTypes: validateDiscTypes(discTypes),
      extras: validateExtras(extras),
      mediaType: validateMediaType(mediaType),
      images: validateImages(images),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    const release: FBRelease = {
      id: '', // Firebase will generate the ID
      title,
      year: parseInt(year),
      containsExtras,
      containsInserts,
      discIds,
      discTypes,
      episodeIds: episodeIds.map(id => ({ id })),
      extras,
      mediaType,
      movieIds: movieIds.map(id => ({ id })),
      seasonIds: seasonIds.map(id => ({ id })),
      seriesIds: seriesIds.map(id => ({ id })),
      images,
    };

    const service = new FirestoreService('releases');
    await service.addDocument(release);
  };

  return (
    <FormControl
      onSubmit={handleSubmit}
      classes={styles.root}
      color="secondary">
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Release</Typography>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Year" value={year} onChange={(e) => setYear(e.target.value)} error={errors.year} />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={containsExtras}
                onChange={(e) => setContainsExtras(e.target.checked)}
              />
            }
            label="Contains Extras"
          />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={containsInserts}
                onChange={(e) => setContainsInserts(e.target.checked)}
              />
            }
            label="Contains Inserts"
          />
        </Grid>
        <Grid size={12}>
          <Typography variant="h6">Disc IDs</Typography>
          {discIds.map((discId, index) => (
            <Grid container spacing={2} key={index}>
              <Grid size={12}>
                <FormTextField label="Disc ID" value={discId} onChange={(e) => handleDiscIdChange(index, e.target.value)} error={errors.discIds} />
              </Grid>
            </Grid>
          ))}
          <Button onClick={handleAddDiscId}>Add Disc ID</Button>
        </Grid>
        <Grid size={12}>
          <Typography variant="h6">Disc Types</Typography>
          {discTypes.map((discType, index) => (
            <Grid container spacing={2} key={index}>
              <Grid size={12}>
                <FormTextField label="Disc Type" value={discType} onChange={(e) => handleDiscTypeChange(index, e.target.value)} error={errors.discTypes} />
              </Grid>
            </Grid>
          ))}
          <Button onClick={handleAddDiscType}>Add Disc Type</Button>
        </Grid>
        <Grid size={12}>
          <Typography variant="h6">Extras</Typography>
          {extras.map((extra, index) => (
            <Grid container spacing={2} key={index}>
              <Grid size={4}>
                <FormTextField label="Title" value={extra.title} onChange={(e) => handleExtraChange(index, 'title', e.target.value)} error={errors.extras} />
              </Grid>
              <Grid size={4}>
                <FormTextField label="Runtime" value={extra.runtime} onChange={(e) => handleExtraChange(index, 'runtime', e.target.value)} error={errors.extras} />
              </Grid>
              <Grid size={4}>
                <FormTextField label="Type" value={extra.type} onChange={(e) => handleExtraChange(index, 'type', e.target.value)} error={errors.extras} />
              </Grid>
            </Grid>
          ))}
          <Button onClick={handleAddExtra}>Add Extra</Button>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Media Type" value={mediaType} onChange={(e) => setMediaType(e.target.value)} error={errors.mediaType} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Movie IDs" value={movieIds.join(', ')} onChange={(e) => setMovieIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Season IDs" value={seasonIds.join(', ')} onChange={(e) => setSeasonIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Series IDs" value={seriesIds.join(', ')} onChange={(e) => setSeriesIds(e.target.value.split(', '))} />
        </Grid>
        <Grid size={12}>
          <Button type="submit" variant="contained" color="primary" onClick={handleSubmit}>
            Add Release
          </Button>
        </Grid>
      </Grid>
    </FormControl>
  );
};

export default ReleaseForm;