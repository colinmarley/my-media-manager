import MoreVertIcon from '@mui/icons-material/MoreVert';
import { IconButton, ListItemText, Menu, MenuItem } from '@mui/material';
import React, { useState } from 'react';

import { fileSource, isFlagged } from '@/service/library/mediaFileModel';
import { MediaFile } from '@/types/library/MediaFile.type';
import { FileActionHandlers } from './fileActionTypes';

interface Props {
  file: MediaFile;
  actions: FileActionHandlers;
}

const NOT_YET = 'Not available on this server yet';

/** The per-row "⋮" menu. A real button, so it is reachable with Tab and opens with Enter / Space. */
const FileRowMenu = ({ file, actions }: Props) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);
  const close = () => setAnchor(null);
  const pick = (fn: () => void) => () => {
    close();
    fn();
  };
  const menuId = `file-menu-${file.id}`;
  const source = fileSource(file);
  const flagged = isFlagged(file);

  return (
    <>
      <IconButton
        size="small"
        aria-label={`Actions for ${file.fileName}`}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={actions.busy}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu id={menuId} anchorEl={anchor} open={open} onClose={close}>
        <MenuItem onClick={pick(() => actions.onLink([file]))}>
          <ListItemText>{source ? 'Link to a different disc/tape…' : 'Link to disc/tape…'}</ListItemText>
        </MenuItem>
        {source && (
          <MenuItem onClick={pick(() => actions.onUnlink([file]))}>
            <ListItemText>Unlink from {source.kind}</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={pick(() => actions.onReassign(file))}>
          <ListItemText>Reassign to another title…</ListItemText>
        </MenuItem>
        {actions.onAssignEpisode && (
          <MenuItem onClick={pick(() => actions.onAssignEpisode!(file))}>
            <ListItemText>Assign episode…</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={pick(() => actions.onSetFlag([file], !flagged))}
          disabled={actions.reviewUnavailable}
        >
          <ListItemText secondary={actions.reviewUnavailable ? NOT_YET : undefined}>
            {flagged ? 'Clear flag' : 'Flag for second look'}
          </ListItemText>
        </MenuItem>
        <MenuItem onClick={pick(() => actions.onRename([file]))} disabled={actions.renameUnavailable}>
          <ListItemText secondary={actions.renameUnavailable ? NOT_YET : undefined}>Rename to canonical…</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

export default FileRowMenu;
