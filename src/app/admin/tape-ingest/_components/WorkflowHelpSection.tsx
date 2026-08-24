'use client';
import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { ExpandMore as ExpandIcon, HelpOutline as HelpIcon } from '@mui/icons-material';

type WorkflowStep = 'pre-scan' | 'post-scan' | 'classify' | 'process';

const HELP: Record<WorkflowStep, { title: string; items: { primary: string; secondary?: string }[] }> = {
  'pre-scan': {
    title: 'Setup Guide: VCR → Portta VD10 → USB',
    items: [
      { primary: 'Connect VCR to Portta VD10', secondary: 'Use RCA composite cables — yellow (video), red & white (audio). Connect to the VD10 input ports.' },
      { primary: 'Connect VD10 to power and insert USB drive', secondary: 'Use a FAT32-formatted USB stick (≤32 GB). The VD10 records directly to USB — no computer needed during recording.' },
      { primary: 'Set VD10 recording quality', secondary: 'Recommended: 720×480 (SD), bitrate 8–12 Mbps. Higher bitrate = better quality but larger files.' },
      { primary: 'Play the tape and press Record on the VD10', secondary: 'Check the LED — red = recording. For SP tapes, expect ~1 GB/hour at standard quality.' },
      { primary: 'Tape speed tip', secondary: 'SP (Standard Play) has the best quality. LP is 2× longer but softer. EP is 3× — expect significant quality loss.' },
      { primary: 'Stop VD10 before removing USB', secondary: 'Press Stop on the VD10 before removing the USB to avoid file corruption.' },
    ],
  },
  'post-scan': {
    title: 'Next Steps: USB → LosslessCut → Ingest Folder',
    items: [
      { primary: 'Copy files from USB to your computer', secondary: 'Plug the USB in, copy MP4 files to a working folder.' },
      { primary: 'Open files in LosslessCut', secondary: 'Drag the file in, or File → Open. Lets you trim without re-encoding.' },
      { primary: 'Remove black/blank sections', secondary: 'Tools → Detect Black Scenes for auto cut points. Set in/out with I/O keys, export with Ctrl+E.' },
      { primary: 'Split recordings into scenes', secondary: 'Use Add Segment (E key) for each event on the tape. Export all segments at once.' },
      { primary: 'Move exported files to the ingress folder', secondary: 'Drop finished MP4s into the ingress folder configured in Settings. Come back here and Scan.' },
    ],
  },
  'classify': {
    title: 'Classification Guide',
    items: [
      { primary: 'Home Video', secondary: 'Family recordings, events, vacations. Fill title, date, people, location.' },
      { primary: 'Movie', secondary: 'A commercially-released film recorded off TV. Search OMDB by title.' },
      { primary: 'TV Show', secondary: 'A recorded TV episode. Search for the series, enter season/episode number.' },
      { primary: 'Trailer', secondary: 'Movie or show trailer. Enter title, target type, target name.' },
      { primary: 'Commercial', secondary: 'An advertisement. Same fields as Trailer.' },
      { primary: 'Skip', secondary: 'Blank tape, static, or content to discard. File will not be processed.' },
      { primary: 'Mixed tapes', secondary: 'If one tape has multiple events, split them in LosslessCut first, then classify each file separately.' },
    ],
  },
  'process': {
    title: 'Processing & FFmpeg Settings',
    items: [
      { primary: 'VHS/VHS-C post-processing', secondary: 'Applies yadif deinterlace + hqdn3d denoise. Takes ~1× realtime per file. Disabled for Mini DV.' },
      { primary: 'When to enable FFmpeg', secondary: 'Enable for VHS/VHS-C with visible interlace lines or heavy grain.' },
      { primary: 'CRF quality (in Settings)', secondary: 'CRF 18 = near-lossless/large. CRF 20 = recommended. CRF 28 = smaller/softer.' },
      { primary: 'Preset (in Settings)', secondary: '"Medium" balances speed and compression. "Slow" gives slightly better compression.' },
      { primary: 'After processing', secondary: 'Files land in the destination folder. Run a Jellyfin library scan to see the new entries.' },
    ],
  },
};

export default function WorkflowHelpSection({ step }: { step: WorkflowStep }) {
  const help = HELP[step];
  return (
    <Accordion disableGutters elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <HelpIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">{help.title}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <List dense disablePadding>
          {help.items.map((item) => (
            <ListItem key={item.primary} disableGutters sx={{ alignItems: 'flex-start', py: 0.5 }}>
              <ListItemText primary={item.primary} secondary={item.secondary}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                secondaryTypographyProps={{ variant: 'caption' }} />
            </ListItem>
          ))}
        </List>
      </AccordionDetails>
    </Accordion>
  );
}
