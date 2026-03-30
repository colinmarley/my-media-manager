import React, { useState } from 'react';
import { TextField, Button, Typography, FormControl, FormControlLabel, Checkbox } from '@mui/material';
import Grid from '@mui/material/Grid';
import useAddDisc from '../../../hooks/newMedia/useAddDisc';
import { ImageFile, VideoFile } from '../../../types/firebase/FBCommon.type';
import ImageSearch from '../imageManager/_components/ImageSearch';
import useDiscValidation from '../../../utils/useDiscValidation';
import styles from '../_styles/DiscForm.module.css';
import SubmitButton from '@/app/_components/SubmitButton';
import { FieldLabel, FormSection, FormSectionStack } from './forms/common';

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

const FormTextField = (props: { label: React.ReactNode, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, error?: string | null }) => (
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
      classes={styles.root}
      color="secondary">
      <Grid container spacing={2}>
        <Grid size={12}>
          <Typography variant="h4" color="white">Add New Disc</Typography>
        </Grid>
        <Grid size={12}>
          <FormSectionStack>
            <FormSection title="Identity" description="Core disc information." titleTooltip="Use this section for the disc title and any existing linked media identifier.">
              <FormTextField label={<FieldLabel label="Title" tooltip="Required. Use a clear physical-disc label, such as Blade Runner (Disc 1)." />} value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
              <FormTextField label={<FieldLabel label="Resource ID" tooltip="Optional legacy link to a related media record. New records should prefer mediaId and mediaType." />} value={resourceId || ''} onChange={(e) => setResourceId(e.target.value)} />
            </FormSection>

            <FormSection title="Physical and Flags" description="Disc physical classification." titleTooltip="Track whether this disc belongs to a set, is a rental, or includes special features.">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isPartOfSet}
                    onChange={(e) => setIsPartOfSet(e.target.checked)}
                  />
                }
                label={<FieldLabel label="Is Part of Set" tooltip="Check this when the disc belongs to a multi-disc boxed set or release package." />}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isRentalDisc}
                    onChange={(e) => setIsRentalDisc(e.target.checked)}
                  />
                }
                label={<FieldLabel label="Is Rental Disc" tooltip="Check this when the disc is a rental copy rather than part of the permanent library." />}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={containsSpecialFeatures}
                    onChange={(e) => setContainsSpecialFeatures(e.target.checked)}
                  />
                }
                label={<FieldLabel label="Contains Special Features" tooltip="Check this when the disc includes extras, supplements, or bonus features." />}
              />
            </FormSection>

            <FormSection title="Video Files" description="Associate video files with this disc." titleTooltip="Add one or more encoded files stored on this physical disc. These entries drive file-level metadata and playback info.">
              <div>
                <label>Video Files:</label>
                <input type="file" multiple onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  const videoFiles = files.map(file => ({
                    fileName: file.name,
                    fileSize: file.size,
                    duration: 0,
                    resolution: '',
                    format: file.type,
                  }));
                  setVideoFiles(videoFiles);
                }} />
              </div>
              {errors.videoFiles && (
                <Typography variant="body2" color="error">{errors.videoFiles}</Typography>
              )}
            </FormSection>

            <FormSection title="Image Files" description="Associate cover art and images." titleTooltip="Attach scans or artwork for this disc edition, including covers, inserts, or menu captures.">
              <div>
                <label>Image Files:</label>
                <input type="file" multiple onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  const imageFiles = files.map(file => ({
                    fileName: file.name,
                    fileSize: file.size,
                    resolution: '',
                    format: file.type,
                  }));
                  setImageFiles(imageFiles);
                }} />
              </div>
              {errors.imageFiles && (
                <Typography variant="body2" color="error">{errors.imageFiles}</Typography>
              )}
              <ImageSearch />
            </FormSection>

            <FormSection title="Optional Metadata" description="Additional disc details." titleTooltip="Fill in supplemental disc attributes like release date, language, subtitles, and region coding.">
              <TextField
                label={<FieldLabel label="Release Date" tooltip="The release date of this physical disc edition." />}
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
              <FormTextField label={<FieldLabel label="Genre" tooltip="Legacy field retained for compatibility. Prefer storing genre on the linked media record instead." />} value={genre || ''} onChange={(e) => setGenre(e.target.value)} error={errors.genre} />
              <FormTextField label={<FieldLabel label="Language" tooltip="Primary playback language for this disc." />} value={language || ''} onChange={(e) => setLanguage(e.target.value)} error={errors.language} />
              <FormTextField label={<FieldLabel label="Subtitles" tooltip="Comma-separated subtitle languages available on the disc." />} value={subtitles?.join(', ') || ''} onChange={(e) => setSubtitles(e.target.value.split(', '))} error={errors.subtitles} />
              <FormTextField label={<FieldLabel label="Region Code" tooltip="Physical disc region code, such as 1, 2, A, or B." />} value={regionCode || ''} onChange={(e) => setRegionCode(e.target.value)} error={errors.regionCode} />
            </FormSection>
          </FormSectionStack>
        </Grid>
        <Grid size={12}>
          <SubmitButton
            label={loading ? 'Adding...' : 'Add Disc'}
            onClick={handleSubmit}
            disabled={loading} />
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