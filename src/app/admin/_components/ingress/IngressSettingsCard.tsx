'use client';

import React from 'react';
import { Box, Button, Card, CardContent, FormControlLabel, Grid, Switch, TextField, Typography } from '@mui/material';

type Props = {
  editThreshold: number;
  onEditThresholdChange: (value: number) => void;
  editAutoOrganize: boolean;
  onEditAutoOrganizeChange: (value: boolean) => void;
  editAutoProcess: boolean;
  onEditAutoProcessChange: (value: boolean) => void;
  savingConfig: boolean;
  onSaveConfig: () => void;
};

const IngressSettingsCard: React.FC<Props> = ({
  editThreshold,
  onEditThresholdChange,
  editAutoOrganize,
  onEditAutoOrganizeChange,
  editAutoProcess,
  onEditAutoProcessChange,
  savingConfig,
  onSaveConfig,
}) => (
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <Typography variant="h6" sx={{ mb: 2 }}>Automation Settings</Typography>
      <Grid container spacing={2} alignItems="center">
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Auto-assign threshold (0–100)"
            type="number"
            fullWidth
            size="small"
            value={editThreshold}
            onChange={(e) => onEditThresholdChange(Number(e.target.value))}
            inputProps={{ min: 0, max: 100 }}
            helperText="Confidence score required for auto-assignment"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={
              <Switch
                checked={editAutoOrganize}
                onChange={(e) => onEditAutoOrganizeChange(e.target.checked)}
              />
            }
            label="Auto-organize files on assignment"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControlLabel
            control={
              <Switch
                checked={editAutoProcess}
                onChange={(e) => onEditAutoProcessChange(e.target.checked)}
              />
            }
            label="Auto-process queue when watcher runs"
          />
        </Grid>
      </Grid>
      <Box sx={{ mt: 2 }}>
        <Button
          variant="contained"
          onClick={onSaveConfig}
          disabled={savingConfig}
        >
          {savingConfig ? 'Saving…' : 'Save Config'}
        </Button>
      </Box>
    </CardContent>
  </Card>
);

export default IngressSettingsCard;
