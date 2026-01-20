"use client";

import React, { useState, useEffect } from 'react';
import TestLibraryScanner from './_components/TestLibraryScanner';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  LinearProgress,
  Chip,
  Divider,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Grid
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Folder as FolderIcon,
  PlayArrow as ScanIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon
} from '@mui/icons-material';
import { LibraryPath, LibrarySettings, DEFAULT_NAMING_CONVENTIONS } from '../../../types/library/LibraryTypes';
import { DEFAULT_LIBRARY_SETTINGS } from '../../../service/library/LibraryScanner';
import { firestoreScanService, ScanResultData } from '../../../service/library/FirestoreScanService';
import { firebaseLibraryService } from '../../../service/library/FirebaseLibraryService';
import { useFirebaseLibraryPaths } from '../../../hooks/library/useFirebaseLibraryPaths';
import useAuthenticationStore from '../../../store/useAuthenticationStore';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`library-tabpanel-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const LibraryManagementPage: React.FC = () => {
  const { user } = useAuthenticationStore();
  const {
    libraryPaths,
    selectedPath,
    isLoading,
    error,
    addLibraryPath,
    removeLibraryPath,
    updateLibraryPath,
    selectLibraryPath,
    clearError,
    getLibraryStatistics
  } = useFirebaseLibraryPaths(user);

  const [currentTab, setCurrentTab] = useState(0);
  const [settings, setSettings] = useState<LibrarySettings>(DEFAULT_LIBRARY_SETTINGS);
  const [showAddPathDialog, setShowAddPathDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [newPathForm, setNewPathForm] = useState({
    name: '',
    rootPath: '',
    mediaType: 'mixed' as 'mixed' | 'movies' | 'series'
  });
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [scanResults, setScanResults] = useState<any[]>([]);
  const [loadingScanResults, setLoadingScanResults] = useState(false);
  const [duplicateReport, setDuplicateReport] = useState<any>(null);
  const [showDuplicateReport, setShowDuplicateReport] = useState(false);

  const statistics = getLibraryStatistics();

  // Load scan results when user changes
  useEffect(() => {
    if (user && currentTab === 1) { // Only load when on Scan Results tab
      loadScanResults();
    }
  }, [user, currentTab]);

  const loadScanResults = async () => {
    if (!user) return;
    
    try {
      setLoadingScanResults(true);
      const results = await firebaseLibraryService.getUserScanResults(user);
      setScanResults(results);
    } catch (err) {
      console.error('Error loading scan results:', err);
    } finally {
      setLoadingScanResults(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setCurrentTab(newValue);
  };

  const handleAddPath = () => {
    if (newPathForm.name && newPathForm.rootPath) {
      const newPath: Omit<LibraryPath, 'id'> = {
        name: newPathForm.name,
        rootPath: newPathForm.rootPath,
        mediaType: newPathForm.mediaType,
        isActive: true,
        createdAt: new Date()
        // Don't include lastScanned - it will be undefined
      };
      
      addLibraryPath(newPath);
      setNewPathForm({ name: '', rootPath: '', mediaType: 'mixed' });
      setShowAddPathDialog(false);
    }
  };

  const handleStartScan = async (path: LibraryPath) => {
    if (!user) {
      alert('You must be logged in to start a scan');
      return;
    }

    setIsScanning(true);
    setScanProgress(0);
    setDuplicateReport(null);
    setShowDuplicateReport(false);
    
    try {
      // Fetch existing files and directories from Firebase before scanning
      const [existingFiles, existingDirectories] = await Promise.all([
        firebaseLibraryService.getUserExistingFiles(user),
        firebaseLibraryService.getUserExistingDirectories(user)
      ]);

      console.log(`Found ${existingFiles.length} existing files and ${existingDirectories.length} existing directories`);

      // Start the actual backend scan with existing data
      const response = await fetch('http://localhost:8082/api/library/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          libraryPath: path.rootPath,
          extractMetadata: settings.extractMetadata || false,
          checkDuplicates: true, // Enable duplicate detection
          userId: user?.uid, // Pass user ID for existing data comparison
          existingFiles: existingFiles,
          existingDirectories: existingDirectories
        }),
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.statusText}`);
      }

      const result = await response.json();
      const currentScanId = result.data?.scanId;

      if (!currentScanId) {
        throw new Error('No scan ID returned from server');
      }

      setScanId(currentScanId);

      // Poll for scan status updates
      const statusInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`http://localhost:8082/api/library/scan/status/${currentScanId}`);
          
          if (statusResponse.ok) {
            const statusResult = await statusResponse.json();
            const scanData = statusResult.data;
            
            if (scanData) {
              const progress = scanData.percentage > 0 
                ? Math.round(scanData.percentage)
                : 0;
              
              setScanProgress(progress);
              setScanStatus(scanData.status);
              
              if (scanData.status === 'completed' || scanData.status === 'error') {
                clearInterval(statusInterval);
                setIsScanning(false);
                
                if (scanData.status === 'completed') {
                  updateLibraryPath(path.id, { lastScanned: new Date() });
                  setScanStatus('Saving to database...');
                  
                  // Fetch scan results from backend
                  try {
                    const resultsResponse = await fetch(`http://localhost:8082/api/library/scan/results/${currentScanId}`);
                    if (resultsResponse.ok) {
                      const resultsData = await resultsResponse.json();
                      const scanResults: ScanResultData = resultsData.data;
                      
                      // Check for duplicate report
                      if (scanResults.duplicateReport && scanResults.duplicateReport.duplicates && scanResults.duplicateReport.duplicates.length > 0) {
                        setDuplicateReport(scanResults.duplicateReport);
                        setShowDuplicateReport(true);
                      }
                      
                      // Save results to Firestore (only new/updated items will be saved)
                      await firestoreScanService.saveScanResults(user, scanResults, path.rootPath);
                      
                      // Clean up scan data from backend memory
                      try {
                        await fetch(`http://localhost:8082/api/library/scan/cleanup/${currentScanId}`, {
                          method: 'DELETE'
                        });
                      } catch (cleanupError) {
                        console.warn('Failed to cleanup scan data:', cleanupError);
                      }
                      
                      setScanStatus('Completed');
                      const duplicateCount = scanResults.duplicateReport?.duplicates?.length || 0;
                      console.log(`Scan completed and saved: ${scanResults.totalFiles} files, ${scanResults.totalDirectories} directories${duplicateCount > 0 ? `, ${duplicateCount} duplicates detected` : ''}`);
                    } else {
                      throw new Error('Failed to fetch scan results');
                    }
                  } catch (saveError) {
                    console.error('Error saving scan results:', saveError);
                    setScanStatus('Error saving results');
                    await firestoreScanService.saveScanError(user, currentScanId, path.rootPath, String(saveError));
                  }
                } else {
                  setScanStatus('Error');
                  console.error('Scan failed:', scanData.errors);
                  await firestoreScanService.saveScanError(user, currentScanId, path.rootPath, JSON.stringify(scanData.errors));
                }
                
                // Clean up
                setScanId(null);
              }
            }
          }
        } catch (error) {
          console.error('Error checking scan status:', error);
        }
      }, 1000); // Check every second

      // Cleanup interval after 5 minutes (safety measure)
      setTimeout(() => {
        clearInterval(statusInterval);
        if (isScanning) {
          setIsScanning(false);
        }
      }, 300000);

    } catch (error) {
      console.error('Error starting scan:', error);
      setIsScanning(false);
      setScanProgress(0);
      setScanStatus('');
      setScanId(null);
      // You might want to show an error message to the user here
      alert(`Failed to start scan: ${error instanceof Error ? error.message : 'Unknown error'}. ${!user ? 'Please ensure you are logged in.' : ''}`);
    }
  };

  const handleStopScan = async () => {
    if (scanId) {
      try {
        const response = await fetch('http://localhost:8082/api/library/scan/stop', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scanId: scanId
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to stop scan: ${response.statusText}`);
        }

        console.log('Scan stopped successfully');
      } catch (error) {
        console.error('Error stopping scan:', error);
      }
    }
    
    setIsScanning(false);
    setScanProgress(0);
    setScanStatus('');
    setScanId(null);
  };

  const handleUpdateSettings = () => {
    // Save settings logic would go here
    setShowSettingsDialog(false);
  };

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" gutterBottom>
        Media Library Management
      </Typography>

      {!user && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Please log in to manage your library paths and access scan results.
        </Alert>
      )}

      {/* Temporary test component for backend integration */}
      <Card sx={{ mb: 3, backgroundColor: '#fff3e0' }}>
        <CardContent>
          <TestLibraryScanner />
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" onClose={clearError} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Library Statistics
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 4 }}>
              <Chip 
                label={`${statistics.totalPaths} Library Paths`} 
                color="primary" 
                size="medium"
              />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Chip 
                label={`${statistics.activePaths} Active`} 
                color="success" 
                size="medium"
              />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <Chip 
                label={statistics.lastScanned ? `Last Scan: ${statistics.lastScanned.toLocaleDateString()}` : 'Never Scanned'} 
                color="info" 
                size="medium"
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={handleTabChange}>
          <Tab label="Library Paths" />
          <Tab label="Scan Results" />
          <Tab label="File Browser" />
          <Tab label="Settings" />
        </Tabs>
      </Box>

      {/* Library Paths Tab */}
      <TabPanel value={currentTab} index={0}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Configure Library Paths</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowAddPathDialog(true)}
          >
            Add Library Path
          </Button>
        </Box>

        <Card>
          <CardContent>
            {libraryPaths.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                No library paths configured. Add a path to get started.
              </Typography>
            ) : (
              <List>
                {libraryPaths.map((path, index) => (
                  <React.Fragment key={path.id}>
                    <ListItem>
                      <FolderIcon sx={{ mr: 2 }} />
                      <ListItemText
                        primary={path.name}
                        secondary={`${path.rootPath} • ${path.mediaType} • ${path.isActive ? 'Active' : 'Inactive'}`}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => handleStartScan(path)}
                          disabled={isScanning}
                        >
                          {isScanning ? <StopIcon /> : <ScanIcon />}
                        </IconButton>
                        <IconButton edge="end" onClick={() => selectLibraryPath(path)}>
                          <EditIcon />
                        </IconButton>
                        <IconButton edge="end" onClick={() => removeLibraryPath(path.id)}>
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                    {index < libraryPaths.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        {isScanning && (
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Scanning Library: {selectedPath?.name || 'Unknown'}
              </Typography>
              <LinearProgress variant="determinate" value={scanProgress} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                Progress: {scanProgress}% {scanStatus && `- ${scanStatus}`}
              </Typography>
              {scanStatus === 'Saving to database...' && (
                <Typography variant="body2" color="primary" sx={{ mt: 1 }}>
                  💾 Saving scan results to database...
                </Typography>
              )}
              {scanStatus === 'Completed' && (
                <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                  ✅ Scan completed and saved successfully!
                </Typography>
              )}
              {scanStatus === 'Completed' && duplicateReport && duplicateReport.duplicates.length > 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    🔍 {duplicateReport.duplicates.length} duplicate(s) detected during scan
                  </Typography>
                  <Button 
                    size="small" 
                    onClick={() => setShowDuplicateReport(true)}
                    variant="outlined"
                  >
                    View Duplicate Report
                  </Button>
                </Alert>
              )}
              {scanStatus === 'Error saving results' && (
                <Typography variant="body2" color="error.main" sx={{ mt: 1 }}>
                  ❌ Scan completed but failed to save results
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Scan ID: {scanId}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleStopScan}
                sx={{ mt: 2 }}
              >
                Stop Scan
              </Button>
            </CardContent>
          </Card>
        )}
      </TabPanel>

      {/* Scan Results Tab */}
      <TabPanel value={currentTab} index={1}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Scan Results</Typography>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadScanResults}
            disabled={loadingScanResults || !user}
          >
            Refresh
          </Button>
        </Box>
        
        <Card>
          <CardContent>
            {!user ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                Please log in to view scan results.
              </Typography>
            ) : loadingScanResults ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                Loading scan results...
              </Typography>
            ) : scanResults.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                No scan results available. Start a library scan to see results here.
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Scan ID</TableCell>
                      <TableCell>Library Path</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Files Found</TableCell>
                      <TableCell>Directories Found</TableCell>
                      <TableCell>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {scanResults.map((result) => (
                      <TableRow key={result.id}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                          {result.scanId?.substring(0, 8)}...
                        </TableCell>
                        <TableCell>{result.libraryPath}</TableCell>
                        <TableCell>
                          <Chip
                            label={result.status}
                            color={result.status === 'completed' ? 'success' : 'error'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>{result.filesFound || 0}</TableCell>
                        <TableCell>{result.directoriesFound || 0}</TableCell>
                        <TableCell>
                          {result.createdAt?.toDate ? 
                            result.createdAt.toDate().toLocaleDateString() : 
                            new Date(result.createdAt).toLocaleDateString()
                          }
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* File Browser Tab */}
      <TabPanel value={currentTab} index={2}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">File Browser</Typography>
          <Button
            variant="contained"
            onClick={() => window.open('/admin/libraryBrowser', '_blank')}
            disabled={!user}
          >
            Open Library Browser
          </Button>
        </Box>
        
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            🆕 New Features Available:
          </Typography>
          <Typography variant="body2">
            • <strong>Show Folder Contents:</strong> Toggle the switch to view all files and subdirectories within each folder
            <br />
            • <strong>Bulk Move to Folder:</strong> Select multiple items and use "Move to Folder" to quickly organize your media files
            <br />
            • <strong>Enhanced Navigation:</strong> Browse folder hierarchies directly without leaving the current view
          </Typography>
        </Alert>
        
        <Card>
          <CardContent>
            {!user ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                Please log in to browse files.
              </Typography>
            ) : scanResults.length === 0 ? (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                No scanned files available. Complete a library scan to browse files.
              </Typography>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body1" gutterBottom>
                  You have {scanResults.reduce((total, result) => total + (result.filesFound || 0), 0)} files 
                  and {scanResults.reduce((total, result) => total + (result.directoriesFound || 0), 0)} directories 
                  from {scanResults.length} scan{scanResults.length !== 1 ? 's' : ''}.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Click "Open Library Browser" above to browse and manage your scanned files with the new folder browsing and bulk move features.
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* Settings Tab */}
      <TabPanel value={currentTab} index={3}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h6">Library Settings</Typography>
          <Button
            variant="contained"
            startIcon={<SettingsIcon />}
            onClick={() => setShowSettingsDialog(true)}
          >
            Edit Settings
          </Button>
        </Box>

        <Card>
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              Naming Conventions
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Media Type</TableCell>
                    <TableCell>Pattern</TableCell>
                    <TableCell>Example</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {settings.defaultNamingConventions.map((convention) => (
                    <TableRow key={convention.type}>
                      <TableCell>{convention.type}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {convention.pattern}
                      </TableCell>
                      <TableCell>{convention.example}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Add Library Path Dialog */}
      <Dialog open={showAddPathDialog} onClose={() => setShowAddPathDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Library Path</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Library Name"
            fullWidth
            variant="outlined"
            value={newPathForm.name}
            onChange={(e) => setNewPathForm(prev => ({ ...prev, name: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            label="Root Path"
            fullWidth
            variant="outlined"
            placeholder="/path/to/media/library"
            value={newPathForm.rootPath}
            onChange={(e) => setNewPathForm(prev => ({ ...prev, rootPath: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <FormControl fullWidth variant="outlined">
            <InputLabel>Media Type</InputLabel>
            <Select
              value={newPathForm.mediaType}
              onChange={(e) => setNewPathForm(prev => ({ ...prev, mediaType: e.target.value as 'mixed' | 'movies' | 'series' }))}
              label="Media Type"
            >
              <MenuItem value="mixed">Mixed (Movies & TV Shows)</MenuItem>
              <MenuItem value="movies">Movies Only</MenuItem>
              <MenuItem value="series">TV Series Only</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddPathDialog(false)}>Cancel</Button>
          <Button onClick={handleAddPath} variant="contained">
            Add Path
          </Button>
        </DialogActions>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onClose={() => setShowSettingsDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>Library Settings</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            Auto-matching Settings
          </Typography>
          <TextField
            margin="dense"
            label="Auto Match Threshold (%)"
            type="number"
            fullWidth
            variant="outlined"
            value={settings.autoMatchThreshold}
            onChange={(e) => setSettings(prev => ({ ...prev, autoMatchThreshold: parseInt(e.target.value) }))}
            sx={{ mb: 2 }}
          />
          
          <Typography variant="subtitle1" gutterBottom>
            File Processing
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Extract Metadata"
              select
              value={settings.extractMetadata ? 'true' : 'false'}
              onChange={(e) => setSettings(prev => ({ ...prev, extractMetadata: e.target.value === 'true' }))}
            >
              <MenuItem value="true">Enabled</MenuItem>
              <MenuItem value="false">Disabled</MenuItem>
            </TextField>
            <TextField
              label="Validate Files"
              select
              value={settings.validateFiles ? 'true' : 'false'}
              onChange={(e) => setSettings(prev => ({ ...prev, validateFiles: e.target.value === 'true' }))}
            >
              <MenuItem value="true">Enabled</MenuItem>
              <MenuItem value="false">Disabled</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSettingsDialog(false)}>Cancel</Button>
          <Button onClick={handleUpdateSettings} variant="contained">
            Save Settings
          </Button>
        </DialogActions>
      </Dialog>

      {/* Duplicate Report Dialog */}
      <Dialog 
        open={showDuplicateReport} 
        onClose={() => setShowDuplicateReport(false)} 
        maxWidth="lg" 
        fullWidth
      >
        <DialogTitle>Duplicate Files Report</DialogTitle>
        <DialogContent>
          {duplicateReport && (
            <Box>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Found {duplicateReport.duplicates.length} file(s) that already exist in the database. 
                The scan only saved new files and folders to avoid duplicates.
              </Typography>
              
              <Typography variant="h6" sx={{ mb: 2 }}>Files with Changes:</Typography>
              
              {duplicateReport.duplicates.length > 0 ? (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>File Path</TableCell>
                        <TableCell>Property</TableCell>
                        <TableCell>Current Value</TableCell>
                        <TableCell>New Value</TableCell>
                        <TableCell>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {duplicateReport.duplicates.map((duplicate: any, index: number) => {
                        if (!duplicate.differences || duplicate.differences.length === 0) {
                          return (
                            <TableRow key={`${duplicate.path}-${index}`}>
                              <TableCell>{duplicate.path}</TableCell>
                              <TableCell colSpan={4}>
                                <Typography color="success.main">
                                  ✅ No differences found - file is identical
                                </Typography>
                              </TableCell>
                            </TableRow>
                          );
                        }
                        
                        return duplicate.differences.map((diff: any, diffIndex: number) => (
                          <TableRow key={`${duplicate.path}-${index}-${diffIndex}`}>
                            {diffIndex === 0 && (
                              <TableCell rowSpan={duplicate.differences.length}>
                                {duplicate.path}
                              </TableCell>
                            )}
                            <TableCell>{diff.field}</TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {diff.currentValue !== undefined ? String(diff.currentValue) : 'N/A'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {diff.newValue !== undefined ? String(diff.newValue) : 'N/A'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip 
                                label="Skipped" 
                                color="warning" 
                                size="small"
                              />
                            </TableCell>
                          </TableRow>
                        ));
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography color="success.main">
                  All files are identical to existing database entries.
                </Typography>
              )}
              
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>Summary:</strong><br/>
                  • Total files scanned: {duplicateReport.totalScanned || 0}<br/>
                  • New files added: {duplicateReport.newFiles || 0}<br/>
                  • Existing files (skipped): {duplicateReport.duplicates.length}<br/>
                  • Files with differences: {duplicateReport.duplicates.filter((d: any) => d.differences && d.differences.length > 0).length}
                </Typography>
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDuplicateReport(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LibraryManagementPage;