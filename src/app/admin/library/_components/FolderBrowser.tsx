/**
 * FolderBrowser Component
 * Allows users to browse and select folders from the file system via backend API
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Box,
  Typography,
  Breadcrumbs,
  Link,
  CircularProgress,
  Alert,
  Chip,
} from '@mui/material';
import {
  Folder,
  FolderOpen,
  Home,
  Computer,
  NavigateNext,
  Check,
} from '@mui/icons-material';

interface FolderBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export default function FolderBrowser({
  open,
  onClose,
  onSelect,
  initialPath = '',
}: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState('');

  useEffect(() => {
    if (open) {
      if (currentPath) {
        loadDirectory(currentPath);
      } else {
        loadRoots();
      }
    }
  }, [open, currentPath]);

  const loadRoots = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/backend/api/files/roots');
      if (!response.ok) throw new Error('Failed to load drive roots');
      
      const result = await response.json();
      setEntries(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roots');
    } finally {
      setLoading(false);
    }
  };

  const loadDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/backend/api/files/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      
      if (!response.ok) throw new Error('Failed to load directory');
      
      const result = await response.json();
      const directories = (result.data || []).filter((entry: DirectoryEntry) => entry.isDirectory);
      setEntries(directories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    setManualPath(path);
  };

  const handleGoUp = () => {
    if (!currentPath) return;
    
    // Handle Windows paths (C:\folder\subfolder)
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator);
    parts.pop();
    
    if (parts.length === 1 && parts[0].includes(':')) {
      // At drive root, go to roots view
      setCurrentPath('');
      setManualPath('');
    } else {
      const parentPath = parts.join(separator);
      handleNavigate(parentPath || '');
    }
  };

  const handleManualPathSubmit = () => {
    if (manualPath) {
      handleNavigate(manualPath);
    }
  };

  const handleSelect = () => {
    onSelect(currentPath || manualPath);
    onClose();
  };

  const getPathParts = () => {
    if (!currentPath) return [];
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator);
    return parts.map((part, index) => ({
      name: part || 'Root',
      path: parts.slice(0, index + 1).join(separator),
    }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Select Folder
        <Typography variant="body2" color="text.secondary">
          Browse and select a folder to scan
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <TextField
            fullWidth
            size="small"
            label="Current Path"
            value={manualPath || currentPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
            placeholder="Enter path manually or browse below"
            InputProps={{
              endAdornment: manualPath && manualPath !== currentPath && (
                <Button size="small" onClick={handleManualPathSubmit}>
                  Go
                </Button>
              ),
            }}
          />
        </Box>

        {/* Breadcrumb navigation */}
        {currentPath && (
          <Box sx={{ mb: 2 }}>
            <Breadcrumbs separator={<NavigateNext fontSize="small" />}>
              <Link
                component="button"
                variant="body2"
                onClick={() => handleNavigate('')}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                <Computer fontSize="small" />
                Drives
              </Link>
              {getPathParts().map((part, index) => (
                <Link
                  key={index}
                  component="button"
                  variant="body2"
                  onClick={() => handleNavigate(part.path)}
                  color={index === getPathParts().length - 1 ? 'text.primary' : 'inherit'}
                  sx={{ fontWeight: index === getPathParts().length - 1 ? 600 : 400 }}
                >
                  {part.name}
                </Link>
              ))}
            </Breadcrumbs>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Box
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            minHeight: 400,
            maxHeight: 400,
            overflow: 'auto',
          }}
        >
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
              <CircularProgress />
            </Box>
          ) : entries.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
              <Typography color="text.secondary">
                {currentPath ? 'No folders found in this directory' : 'Click to browse drives'}
              </Typography>
            </Box>
          ) : (
            <List dense>
              {currentPath && (
                <ListItem disablePadding>
                  <ListItemButton onClick={handleGoUp}>
                    <ListItemIcon>
                      <FolderOpen color="action" />
                    </ListItemIcon>
                    <ListItemText 
                      primary=".." 
                      secondary="Go up one level"
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                  </ListItemButton>
                </ListItem>
              )}
              {entries.map((entry) => (
                <ListItem key={entry.path} disablePadding>
                  <ListItemButton onClick={() => handleNavigate(entry.path)}>
                    <ListItemIcon>
                      <Folder color="primary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={entry.name}
                      secondary={entry.path}
                      secondaryTypographyProps={{ 
                        sx: { fontSize: '0.75rem', fontFamily: 'monospace' } 
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        {currentPath && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" gutterBottom>
              Selected Path:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {currentPath}
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSelect}
          variant="contained"
          disabled={!currentPath && !manualPath}
          startIcon={<Check />}
        >
          Select This Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
}
