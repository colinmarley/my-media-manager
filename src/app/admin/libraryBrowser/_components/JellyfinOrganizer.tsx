/**
 * JellyfinOrganizer Component
 * Triggers and monitors file organization operations
 * Shows target structure, previews operations, and tracks progress
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Paper,
  Stack,
  LinearProgress,
  Alert,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Divider,
} from '@mui/material';
import {
  PlayArrow,
  CheckCircle,
  Error as ErrorIcon,
  Folder,
  DriveFileMove,
  CreateNewFolder,
  Info,
} from '@mui/icons-material';
import { MediaAssignment } from '@/types/library';
import MediaOrganizationService from '@/service/library/MediaOrganizationService';

interface JellyfinOrganizerProps {
  open: boolean;
  onClose: () => void;
  assignment: MediaAssignment | null;
  onComplete: () => void;
}

interface OperationStatus {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message?: string;
}

export default function JellyfinOrganizer({
  open,
  onClose,
  assignment,
  onComplete,
}: JellyfinOrganizerProps) {
  const [organizing, setOrganizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [operations, setOperations] = useState<OperationStatus[]>([
    { step: 'Validate assignment', status: 'pending' },
    { step: 'Create Jellyfin folder structure', status: 'pending' },
    { step: 'Move files to target location', status: 'pending' },
    { step: 'Update database records', status: 'pending' },
    { step: 'Validate folder structure', status: 'pending' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const orgService = new MediaOrganizationService();

  const updateOperation = (index: number, status: OperationStatus['status'], message?: string) => {
    setOperations(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], status, message };
      return updated;
    });
  };

  const handleOrganize = async () => {
    if (!assignment) return;

    setOrganizing(true);
    setError(null);
    setProgress(0);

    try {
      // Step 1: Validate assignment
      updateOperation(0, 'running');
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async operation
      
      if (!assignment.targetFolder || !assignment.fileId) {
        throw new Error('Invalid assignment: missing target folder or file ID');
      }
      
      updateOperation(0, 'completed');
      setProgress(20);

      // Step 2: Create Jellyfin folder structure
      updateOperation(1, 'running');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const jellyfinFolder = await orgService.createJellyfinFolder({
        folderPath: assignment.targetFolder.fullPath,
        jellyfinName: assignment.targetFolder.jellyfinFolderName,
        mediaType: assignment.mediaType,
        mediaId: assignment.mediaId,
        validation: { isCompliant: false },
      });
      
      updateOperation(1, 'completed', `Folder ID: ${jellyfinFolder.id}`);
      setProgress(40);

      // Step 3: Move files
      updateOperation(2, 'running');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // TODO: Call backend API to move files
      const moveResponse = await fetch('/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: assignment.fileId,
          sourcePath: assignment.sourceFile?.filePath,
          targetPath: assignment.targetFolder.fullPath,
        }),
      });

      if (!moveResponse.ok) {
        throw new Error('File move operation failed');
      }
      
      updateOperation(2, 'completed');
      setProgress(60);

      // Step 4: Update database
      updateOperation(3, 'running');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update assignment status
      await fetch(`/api/assignments/${assignment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'organized',
          organizationHistory: [
            ...(assignment.organizationHistory || []),
            {
              timestamp: new Date().toISOString(),
              operation: 'organize',
              sourcePath: assignment.sourceFile?.filePath,
              targetPath: assignment.targetFolder.fullPath,
              status: 'completed',
            },
          ],
        }),
      });
      
      updateOperation(3, 'completed');
      setProgress(80);

      // Step 5: Validate structure
      updateOperation(4, 'running');
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const isValid = await orgService.validateJellyfinStructure(jellyfinFolder.id);
      
      if (!isValid) {
        updateOperation(4, 'failed', 'Validation failed - structure may not be fully compliant');
      } else {
        updateOperation(4, 'completed', 'Structure is Jellyfin-compliant');
      }
      
      setProgress(100);

      // Success - wait a moment then close
      setTimeout(() => {
        onComplete();
        onClose();
      }, 2000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      
      // Mark current operation as failed
      const failedIndex = operations.findIndex(op => op.status === 'running');
      if (failedIndex >= 0) {
        updateOperation(failedIndex, 'failed', errorMessage);
      }
    } finally {
      setOrganizing(false);
    }
  };

  const getStatusIcon = (status: OperationStatus['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle color="success" />;
      case 'running':
        return <LinearProgress sx={{ width: 20 }} />;
      case 'failed':
        return <ErrorIcon color="error" />;
      default:
        return <Folder color="disabled" />;
    }
  };

  const getStatusColor = (status: OperationStatus['status']) => {
    switch (status) {
      case 'completed':
        return 'success.main';
      case 'running':
        return 'primary.main';
      case 'failed':
        return 'error.main';
      default:
        return 'text.disabled';
    }
  };

  if (!assignment) {
    return null;
  }

  return (
    <Dialog open={open} onClose={!organizing ? onClose : undefined} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DriveFileMove />
          Organize Files for Jellyfin
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3}>
          {/* Assignment Info */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
            <Typography variant="subtitle2" gutterBottom>
              Assignment Details
            </Typography>
            <Stack spacing={1}>
              <Box>
                <Typography variant="caption" color="text.secondary">Media Type</Typography>
                <Typography variant="body2">
                  <Chip 
                    label={assignment.mediaType.toUpperCase()} 
                    size="small" 
                    color={assignment.mediaType === 'movie' ? 'primary' : 'secondary'}
                  />
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Source File</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {assignment.sourceFile?.fileName || 'Unknown'}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Target Location</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {assignment.targetFolder?.fullPath || 'Unknown'}
                </Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Progress */}
          {organizing && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">Organization Progress</Typography>
                <Typography variant="body2" color="text.secondary">
                  {progress}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={progress} />
            </Box>
          )}

          {/* Error */}
          {error && (
            <Alert severity="error" icon={<ErrorIcon />}>
              <Typography variant="subtitle2">Organization Failed</Typography>
              <Typography variant="body2">{error}</Typography>
            </Alert>
          )}

          {/* Operations List */}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Operations
            </Typography>
            <List dense>
              {operations.map((operation, index) => (
                <ListItem key={index}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {getStatusIcon(operation.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={operation.step}
                    secondary={operation.message}
                    primaryTypographyProps={{
                      color: getStatusColor(operation.status),
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>

          {/* Info Note */}
          <Alert severity="info" icon={<Info />}>
            This will move files to the Jellyfin-compliant folder structure. 
            The original files will be moved (not copied).
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={organizing}>
          Cancel
        </Button>
        <Button
          onClick={handleOrganize}
          variant="contained"
          disabled={organizing || !assignment.targetFolder}
          startIcon={<PlayArrow />}
        >
          {organizing ? 'Organizing...' : 'Start Organization'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
