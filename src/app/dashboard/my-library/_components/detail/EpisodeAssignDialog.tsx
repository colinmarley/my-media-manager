import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { SeriesEpisodeOption } from '@/service/library/mediaDetailModel';

interface Props {
  open: boolean;
  onClose: () => void;
  file: { path: string; name: string } | null;
  season: string;
  /** Manual season entry: keeps the current episode value. */
  onSeasonChange: (season: string) => void;
  /** Picking a season from the show metadata resets the episode selection. */
  onSeasonSelectChange: (season: string) => void;
  episode: string;
  onEpisodeChange: (episode: string) => void;
  seasonOptions: SeriesEpisodeOption[];
  episodeOptions: { episodeNumber: number; title: string }[];
  saving: boolean;
  error: string | null;
  onAssign: (keepOriginalName: boolean) => void;
}

/** Maps a loose file in a series folder onto a catalogued episode. */
const EpisodeAssignDialog = ({
  open,
  onClose,
  file,
  season,
  onSeasonChange,
  onSeasonSelectChange,
  episode,
  onEpisodeChange,
  seasonOptions,
  episodeOptions,
  saving,
  error,
  onAssign,
}: Props) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>Assign File to Episode</DialogTitle>
    <DialogContent>
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        <Alert severity="info">
          Pick the correct episode from the show metadata, or move the file to the unknown season folder while keeping its original filename.
        </Alert>

        {file && (
          <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
            File: {file.name}
          </Typography>
        )}

        {seasonOptions.length > 0 ? (
          <>
            <FormControl fullWidth>
              <InputLabel id="episode-assign-season-label">Season</InputLabel>
              <Select
                labelId="episode-assign-season-label"
                label="Season"
                value={season}
                onChange={(e) => onSeasonSelectChange(e.target.value)}
              >
                {seasonOptions.map((seasonOption) => (
                  <MenuItem key={seasonOption.seasonNumber} value={String(seasonOption.seasonNumber)}>
                    Season {seasonOption.seasonNumber.toString().padStart(2, '0')} · {seasonOption.seasonTitle}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="episode-assign-episode-label">Episode</InputLabel>
              <Select
                labelId="episode-assign-episode-label"
                label="Episode"
                value={episode}
                onChange={(e) => onEpisodeChange(e.target.value)}
              >
                {episodeOptions.map((episodeOption) => (
                  <MenuItem key={episodeOption.episodeNumber} value={String(episodeOption.episodeNumber)}>
                    E{episodeOption.episodeNumber.toString().padStart(2, '0')} · {episodeOption.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              fullWidth
              type="number"
              label="Season"
              value={season}
              onChange={(e) => onSeasonChange(e.target.value)}
            />
            <TextField
              fullWidth
              type="number"
              label="Episode"
              value={episode}
              onChange={(e) => onEpisodeChange(e.target.value)}
            />
          </Stack>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={saving}>Cancel</Button>
      <Button onClick={() => onAssign(true)} disabled={saving} color="warning">
        Keep Filename in Unknown Folder
      </Button>
      <Button variant="contained" onClick={() => onAssign(false)} disabled={saving}>
        {saving ? <CircularProgress size={18} color="inherit" /> : 'Assign Episode'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default EpisodeAssignDialog;
