import React, { useState } from 'react';
import { TextField, Button, Typography, FormControl, FormControlLabel, Checkbox } from '@mui/material';
import Grid from '@mui/material/Grid2';
import useAddDisc from '../../../hooks/newMedia/useAddDisc';
import { ImageFile, VideoFile } from '../../../types/firebase/FBCommon.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useDiscValidation from '../../../utils/useDiscValidation';
import styles from '../_styles/DiscForm.module.css';

interface DiscValidation {
  title: string | null;
  videoFiles: string | null;
  imageFiles: string | null;
  releaseDate: string | null;
  genre: string | null;
  language: string | null;
  subtitles: string | null;
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

const AddDiscForm: React.FC = () => {
  const { addDisc, loading, error } = useAddDisc();
  const [title, setTitle] = useState('');
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [isPartOfSet, setIsPartOfSet] = useState(false);
  const [isRentalDisc, setIsRentalDisc] = useState(false);
  const [containsSpecialFeatures, setContainsSpecialFeatures] = useState(false);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [releaseDate, setReleaseDate] = useState<string | undefined>(undefined);
  const [genre, setGenre] = useState<string | undefined>(undefined);
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const [subtitles, setSubtitles] = useState<string[] | undefined>(undefined);
  const [regionCode, setRegionCode] = useState<string | undefined>(undefined);

  const {
    validateTitle,
    validateVideoFiles,
    validateImageFiles,
    validateReleaseDate,
    validateGenre,
    validateLanguage,
    validateSubtitles,
    validateRegionCode,
  } = useDiscValidation();

  const [errors, setErrors] = useState<DiscValidation>({
    title: null,
    videoFiles: null,
    imageFiles: null,
    releaseDate: null,
    genre: null,
    language: null,
    subtitles: null,
    regionCode: null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const newErrors = {
      title: validateTitle(title),
      videoFiles: validateVideoFiles(videoFiles),
      imageFiles: validateImageFiles(imageFiles),
      releaseDate: validateReleaseDate(releaseDate),
      genre: validateGenre(genre),
      language: validateLanguage(language),
      subtitles: validateSubtitles(subtitles),
      regionCode: validateRegionCode(regionCode),
    };

    setErrors(newErrors);

    const hasErrors = Object.values(newErrors).some(error => error !== null);
    if (hasErrors) {
      return;
    }

    await addDisc(
      title,
      videoFiles,
      imageFiles,
      isPartOfSet,
      isRentalDisc,
      containsSpecialFeatures,
      resourceId,
      releaseDate,
      genre,
      language,
      subtitles,
      regionCode
    );
  };

  return (
    <FormControl
      onSubmit={handleSubmit}
      classes={styles.root}
      color="secondary">
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Disc</Typography>
        </Grid>
        <Grid size={12}>
          <FormTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
        </Grid>
        <Grid size={12}>
          <label>Video Files:</label>
          <input type="file" multiple onChange={(e) => {
            const files = Array.from(e.target.files || []);
            const videoFiles = files.map(file => ({
              fileName: file.name,
              fileSize: file.size,
              duration: 0, // Placeholder, you might want to handle this differently
              resolution: '', // Placeholder, you might want to handle this differently
              format: file.type,
            }));
            setVideoFiles(videoFiles);
          }} />
        </Grid>
        <Grid size={12}>
          <label>Image Files:</label>
          <input type="file" multiple onChange={(e) => {
            const files = Array.from(e.target.files || []);
            const imageFiles = files.map(file => ({
              fileName: file.name,
              fileSize: file.size,
              resolution: '', // Placeholder, you might want to handle this differently
              format: file.type,
            }));
            setImageFiles(imageFiles);
          }} />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={isPartOfSet}
                onChange={(e) => setIsPartOfSet(e.target.checked)}
              />
            }
            label="Is Part of Set"
          />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={isRentalDisc}
                onChange={(e) => setIsRentalDisc(e.target.checked)}
              />
            }
            label="Is Rental Disc"
          />
        </Grid>
        <Grid size={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={containsSpecialFeatures}
                onChange={(e) => setContainsSpecialFeatures(e.target.checked)}
              />
            }
            label="Contains Special Features"
          />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Resource ID" value={resourceId || ''} onChange={(e) => setResourceId(e.target.value)} />
        </Grid>
        <Grid size={12}>
          <TextField
            label="Release Date"
            type="date"
            value={releaseDate || ''}
            onChange={(e) => setReleaseDate(e.target.value)}
            fullWidth
            InputLabelProps={{
              shrink: true,
            }}
            error={!!errors.releaseDate}
            helperText={errors.releaseDate}
          />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Genre" value={genre || ''} onChange={(e) => setGenre(e.target.value)} error={errors.genre} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Language" value={language || ''} onChange={(e) => setLanguage(e.target.value)} error={errors.language} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Subtitles" value={subtitles?.join(', ') || ''} onChange={(e) => setSubtitles(e.target.value.split(', '))} error={errors.subtitles} />
        </Grid>
        <Grid size={12}>
          <FormTextField label="Region Code" value={regionCode || ''} onChange={(e) => setRegionCode(e.target.value)} error={errors.regionCode} />
        </Grid>
        <Grid size={12}>
          <ImageSearch />
        </Grid>
        <Grid size={12}>
          <Button type="submit" variant="contained" color="primary" disabled={loading}>
            {loading ? 'Adding...' : 'Add Disc'}
          </Button>
        </Grid>
        {error && (
          <Grid size={12}>
            <Typography variant="body1" color="error">{error}</Typography>
          </Grid>
        )}
      </Grid>
    </FormControl>
  );
};

export default AddDiscForm;