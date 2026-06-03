"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

interface PreviewMove {
  sourcePath: string;
  sourceName: string;
  category: string;
  detectedCategory: string;
  targetFileName: string;
  targetSubfolder: string | null;
  targetPath: string;
  moveNeeded: boolean;
  size: number;
}

interface PreviewFolder {
  success: boolean;
  folderPath: string;
  folderName: string;
  moveCount: number;
  moves: PreviewMove[];
  supportedCategories?: string[];
}

interface EditableMove extends PreviewMove {
  folderPath: string;
  folderName: string;
}

interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

interface DestFolderInfo {
  destBase: string;
  exists: boolean;
  writable: boolean;
  categoryFolders: Record<string, string>;
}

function computeTargetPath(row: EditableMove, category: string, targetFileName: string): string {
  const trimmedName = targetFileName.trim() || row.sourceName;
  if (category === "main_feature" || category === "version") {
    return `${row.folderPath}/${trimmedName}`;
  }
  return `${row.folderPath}/${category}/${trimmedName}`;
}

const DEFAULT_CATEGORIES = [
  "main_feature",
  "version",
  "trailers",
  "samples",
  "featurettes",
  "behind the scenes",
  "deleted scenes",
  "interviews",
  "scenes",
  "clips",
  "shorts",
  "other",
  "extras",
  "theme-music",
  "backdrops",
];

export default function MovieOrganizationPage() {
  const [moviesRoot, setMoviesRoot] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [mode, setMode] = useState<"all" | "folder">("all");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [supportedCategories, setSupportedCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [rows, setRows] = useState<EditableMove[]>([]);
  const [folderCount, setFolderCount] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerRoot, setPickerRoot] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const [pickerEntries, setPickerEntries] = useState<FolderEntry[]>([]);

  const moveCount = useMemo(() => rows.filter((row) => row.moveNeeded).length, [rows]);

  const joinPath = (base: string, segment: string) => {
    if (!base) return segment;
    if (base.endsWith("/") || base.endsWith("\\")) {
      return `${base}${segment}`;
    }
    return `${base}/${segment}`;
  };

  const getParentPath = (path: string): string => {
    const trimmed = path.replace(/[\\/]+$/, "");
    const pieces = trimmed.split(/[\\/]+/);
    if (pieces.length <= 1) return path;
    const parentParts = pieces.slice(0, -1);
    if (trimmed.startsWith("/")) {
      return `/${parentParts.filter(Boolean).join("/")}`;
    }
    if (/^[A-Za-z]:/.test(trimmed)) {
      const drive = parentParts[0] || "";
      const rest = parentParts.slice(1);
      return rest.length ? `${drive}/${rest.join("/")}` : `${drive}/`;
    }
    return parentParts.join("/");
  };

  const loadPickerPath = async (path: string) => {
    setPickerLoading(true);
    setPickerError(null);
    try {
      const response = await fetch("/api/backend/api/files/dest-folder/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.detail || "Failed to browse folders");
      }
      const directories = ((json.data || []) as FolderEntry[]).filter((entry) => entry.isDirectory);
      setPickerEntries(directories);
      setPickerPath(path);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "Failed to browse folders");
    } finally {
      setPickerLoading(false);
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerError(null);
    try {
      const response = await fetch("/api/backend/api/files/dest-folder");
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.detail || "Failed to load destination info");
      }
      const info = json.data as DestFolderInfo;
      const defaultMoviesRoot = joinPath(info.destBase, info.categoryFolders?.movie || "Movies");
      const startPath = moviesRoot.trim() || defaultMoviesRoot;
      setPickerRoot(startPath);
      await loadPickerPath(startPath);
    } catch (err) {
      setPickerError(err instanceof Error ? err.message : "Failed to open folder picker");
      setPickerLoading(false);
    }
  };

  const buildOverrides = () => rows.map((row) => ({
    sourcePath: row.sourcePath,
    category: row.category,
    targetFileName: row.targetFileName,
  }));

  const handlePreviewAll = async () => {
    setMode("all");
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/backend/api/files/dest-folder/organize-movies/preview-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moviesRoot: moviesRoot.trim() || null }),
      });

      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.detail || json?.data?.error || "Preview failed");
      }

      const data = json.data;
      const folders: PreviewFolder[] = data.folders || [];
      const nextRows: EditableMove[] = [];
      folders.forEach((folder) => {
        (folder.moves || []).forEach((move) => {
          nextRows.push({
            ...move,
            folderPath: folder.folderPath,
            folderName: folder.folderName,
          });
        });
      });

      setRows(nextRows);
      setFolderCount(data.folderCount || folders.length);
      setSupportedCategories(data.supportedCategories || DEFAULT_CATEGORIES);
      setSuccess(`Preview loaded for ${data.folderCount || folders.length} folders.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewFolder = async () => {
    if (!folderPath.trim()) {
      setError("Enter a movie folder path first.");
      return;
    }

    setMode("folder");
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/backend/api/files/dest-folder/organize-movies/preview-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: folderPath.trim(),
          overrides: [],
        }),
      });

      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.detail || json?.data?.error || "Preview failed");
      }

      const folder: PreviewFolder = json.data;
      const nextRows = (folder.moves || []).map((move) => ({
        ...move,
        folderPath: folder.folderPath,
        folderName: folder.folderName,
      }));

      setRows(nextRows);
      setFolderCount(1);
      setSupportedCategories(folder.supportedCategories || DEFAULT_CATEGORIES);
      setSuccess(`Preview loaded for ${folder.folderName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (rows.length === 0) {
      setError("Run a preview first.");
      return;
    }

    setApplying(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === "all") {
        const response = await fetch("/api/backend/api/files/dest-folder/organize-movies/apply-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            moviesRoot: moviesRoot.trim() || null,
            overrides: buildOverrides(),
          }),
        });

        const json = await response.json();
        if (!response.ok || !json?.success) {
          throw new Error(json?.detail || json?.data?.error || "Apply failed");
        }

        const totalMovesApplied = json?.data?.totalMovesApplied || 0;
        setSuccess(`Applied changes across all folders. Moves applied: ${totalMovesApplied}.`);
      } else {
        const response = await fetch("/api/backend/api/files/dest-folder/organize-movies/apply-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderPath: folderPath.trim(),
            overrides: buildOverrides(),
          }),
        });

        const json = await response.json();
        if (!response.ok || !json?.success) {
          throw new Error(json?.detail || json?.data?.error || "Apply failed");
        }

        const movesApplied = json?.data?.movesApplied || 0;
        setSuccess(`Applied changes for selected folder. Moves applied: ${movesApplied}.`);
      }

      if (mode === "all") {
        await handlePreviewAll();
      } else {
        await handlePreviewFolder();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const updateRow = (sourcePath: string, update: Partial<EditableMove>) => {
    setRows((prev) => prev.map((row) => {
      if (row.sourcePath !== sourcePath) return row;

      const nextCategory = String(update.category ?? row.category);
      const nextTargetFileName = String(update.targetFileName ?? row.targetFileName);
      const nextTargetPath = computeTargetPath(row, nextCategory, nextTargetFileName);
      const nextTargetSubfolder = nextCategory === "main_feature" || nextCategory === "version"
        ? null
        : nextCategory;
      const nextMoveNeeded = row.sourcePath !== nextTargetPath;

      return {
        ...row,
        ...update,
        category: nextCategory,
        targetFileName: nextTargetFileName,
        targetSubfolder: nextTargetSubfolder,
        targetPath: nextTargetPath,
        moveNeeded: nextMoveNeeded,
      };
    }));
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 1 }}>
        Movie Folder Organizer
      </Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Preview and apply Jellyfin-compliant organization for processed movie folders. Edit category and target filename per file before applying.
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Movies Root (optional)"
                value={moviesRoot}
                onChange={(event) => setMoviesRoot(event.target.value)}
                placeholder="Defaults to configured Movies folder"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Stack direction="row" spacing={1}>
                <TextField
                  fullWidth
                  label="Selected Movie Folder"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder="/path/to/Movie Name (Year) [imdbid-tt1234567]"
                />
                <Button variant="outlined" onClick={openPicker} disabled={loading || applying}>
                  Browse
                </Button>
              </Stack>
            </Grid>
          </Grid>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={handlePreviewAll} disabled={loading || applying}>
              Preview All Processed Movies
            </Button>
            <Button variant="outlined" onClick={handlePreviewFolder} disabled={loading || applying}>
              Preview Selected Folder
            </Button>
            <Button variant="contained" color="primary" onClick={handleApply} disabled={loading || applying || rows.length === 0}>
              {applying ? "Applying..." : mode === "all" ? "Apply All" : "Apply Folder"}
            </Button>
          </Stack>

          {(loading || applying) && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">{loading ? "Building preview..." : "Applying changes..."}</Typography>
            </Stack>
          )}
        </CardContent>
      </Card>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <Chip label={`Mode: ${mode === "all" ? "All Folders" : "Single Folder"}`} color="primary" />
        <Chip label={`Folders: ${folderCount}`} />
        <Chip label={`Files Proposed: ${rows.length}`} />
        <Chip label={`Moves Needed: ${moveCount}`} color={moveCount > 0 ? "warning" : "success"} />
      </Stack>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>Proposed Changes</Typography>
          <TableContainer sx={{ maxHeight: 640 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Folder</TableCell>
                  <TableCell>Source File</TableCell>
                  <TableCell>Detected Category</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Target File Name</TableCell>
                  <TableCell>Target Path</TableCell>
                  <TableCell>Move?</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.sourcePath} hover>
                    <TableCell>{row.folderName}</TableCell>
                    <TableCell>{row.sourceName}</TableCell>
                    <TableCell>{row.detectedCategory}</TableCell>
                    <TableCell>
                      <FormControl fullWidth size="small" sx={{ minWidth: 180 }}>
                        <InputLabel id={`cat-${row.sourcePath}`}>Category</InputLabel>
                        <Select
                          labelId={`cat-${row.sourcePath}`}
                          label="Category"
                          value={row.category}
                          onChange={(event) => updateRow(row.sourcePath, { category: event.target.value })}
                        >
                          {supportedCategories.map((category) => (
                            <MenuItem key={category} value={category}>{category}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={row.targetFileName}
                        onChange={(event) => updateRow(row.sourcePath, { targetFileName: event.target.value })}
                        sx={{ minWidth: 260 }}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.targetPath}
                    </TableCell>
                    <TableCell>{row.moveNeeded ? "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Pick Movie Folder</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {pickerError && <Alert severity="error">{pickerError}</Alert>}
            <TextField
              fullWidth
              label="Current Path"
              value={pickerPath}
              onChange={(event) => setPickerPath(event.target.value)}
              onBlur={() => {
                if (pickerPath.trim()) {
                  void loadPickerPath(pickerPath.trim());
                }
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                onClick={() => void loadPickerPath(pickerRoot)}
                disabled={pickerLoading || !pickerRoot}
              >
                Root
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  const parent = getParentPath(pickerPath);
                  if (parent && parent !== pickerPath) {
                    void loadPickerPath(parent);
                  }
                }}
                disabled={pickerLoading || !pickerPath || pickerPath === pickerRoot}
              >
                Up
              </Button>
            </Stack>
            {pickerLoading ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">Loading folders...</Typography>
              </Stack>
            ) : (
              <List dense sx={{ maxHeight: 360, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                {pickerEntries.length === 0 ? (
                  <ListItem>
                    <ListItemText primary="No subfolders found." />
                  </ListItem>
                ) : pickerEntries.map((entry) => (
                  <ListItem key={entry.path} disablePadding>
                    <ListItemButton onClick={() => void loadPickerPath(entry.path)}>
                      <ListItemText primary={entry.name} secondary={entry.path} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setFolderPath(pickerPath);
              setPickerOpen(false);
            }}
            disabled={!pickerPath}
          >
            Use This Folder
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
