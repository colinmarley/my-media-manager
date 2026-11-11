import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  ButtonBase,
  Checkbox,
  Collapse,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React, { useId, useState } from 'react';

import { formatBytes } from '@/utils/format';
import { borders, surfaces } from '@/theme/tokens';
import { FileSection } from '@/service/library/mediaFileModel';
import { FileActionHandlers } from './fileActionTypes';
import FileRow, { FILE_COLUMNS } from './FileRow';

interface Props {
  section: FileSection;
  selected: Set<string>;
  onToggle: (fileId: string) => void;
  onToggleMany: (fileIds: string[], select: boolean) => void;
  actions: FileActionHandlers;
  /** Seasons start expanded unless told otherwise. */
  defaultExpanded?: boolean;
}

const RIGHT_ALIGNED = new Set(['Size', 'Duration']);

/** One group of the Files tab (Main feature, Versions, Season 2, …) as its own captioned table. */
const FileSectionTable = ({ section, selected, onToggle, onToggleMany, actions, defaultExpanded = true }: Props) => {
  const collapsible = section.season !== undefined;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = useId();
  const regionId = useId();
  const ids = section.files.map((file) => file.id);
  const selectedCount = ids.filter((id) => selected.has(id)).length;
  const totalSize = section.files.reduce((sum, file) => sum + (file.fileSize ?? 0), 0);
  const count = `${section.files.length} file${section.files.length === 1 ? '' : 's'}`;

  const heading = (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Typography id={headingId} variant="h6" component="h3">{section.title}</Typography>
      <Typography variant="caption" color="text.secondary">
        {count} · {formatBytes(totalSize, { precision: 'video' })}
      </Typography>
    </Box>
  );

  const table = (
    <TableContainer sx={{ border: `1px solid ${borders.default}`, borderRadius: 1, bgcolor: surfaces.paper, overflowX: 'auto' }}>
      <Table size="small" aria-labelledby={headingId} sx={{ minWidth: 1100 }}>
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                size="small"
                checked={selectedCount > 0 && selectedCount === ids.length}
                indeterminate={selectedCount > 0 && selectedCount < ids.length}
                onChange={(e) => onToggleMany(ids, e.target.checked)}
                slotProps={{ input: { 'aria-label': `Select all files in ${section.title}` } }}
              />
            </TableCell>
            {FILE_COLUMNS.map((column) => (
              <TableCell key={column} align={RIGHT_ALIGNED.has(column) ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                {column}
              </TableCell>
            ))}
            <TableCell padding="checkbox"><Box component="span" sx={visuallyHidden}>Actions</Box></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {section.files.map((file) => (
            <FileRow key={file.id} file={file} selected={selected.has(file.id)} onToggle={onToggle} actions={actions} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );

  if (!collapsible) {
    return (
      <Box component="section" sx={{ mb: 3 }}>
        <Box sx={{ mb: 1 }}>{heading}</Box>
        {table}
      </Box>
    );
  }

  return (
    <Box component="section" sx={{ mb: 2 }}>
      <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
        <ButtonBase
          id={headingId}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={regionId}
          sx={{ display: 'flex', width: '100%', justifyContent: 'flex-start', alignItems: 'baseline', gap: 1, py: 0.75, borderRadius: 1, textAlign: 'left', font: 'inherit' }}
        >
          <ExpandMoreIcon
            fontSize="small"
            aria-hidden
            sx={{ alignSelf: 'center', transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 150ms' }}
          />
          <span>{section.title}</span>
          <Typography variant="caption" color="text.secondary" component="span">{count}</Typography>
        </ButtonBase>
      </Typography>
      <Collapse in={expanded} id={regionId} unmountOnExit={false}>
        {table}
      </Collapse>
    </Box>
  );
};

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

export default FileSectionTable;
