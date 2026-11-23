'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Collapse, Link, MenuItem,
  Paper, Stack, TextField, Typography,
} from '@mui/material';
import {
  createDisc, createRelease, getRelease, mergeDisc, searchBoxes, searchDiscs, searchReleases, updateRelease,
} from '@/service/catalog/DiscCatalogService';
import { CatalogDisc, CatalogRelease } from '@/types/catalog/Disc.type';
import type { DiscFormat } from '@/types/catalog/Common.type';
import {
  describeCatalogDisc, discNumberFromLabel, discRecordTitle, suggestReleaseTitle,
} from './discRipperUtils';

const FORMAT_OPTIONS: { value: DiscFormat; label: string }[] = [
  { value: 'DVD', label: 'DVD' },
  { value: 'BLURAY', label: 'Blu-ray' },
  { value: 'UHD_BLURAY', label: '4K UHD Blu-ray' },
  { value: 'HD_DVD', label: 'HD DVD' },
];

/** The disc details form, as typed. */
export interface DiscForm {
  /** The name on the box or case. */
  releaseTitle: string;
  /** Set when the box is one already in the catalog. */
  releaseId: string | null;
  discNumber: string;
  /** How many discs the box holds. */
  discCount: string;
  edition: string;
  format: DiscFormat;
  barcode: string;
}

function positiveInt(text: string): number | null {
  const n = parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The two records a filled-in form describes: the box (release) and the
 * disc in it. The disc is named after the box (its number is a field of its
 * own), so nobody has to invent a separate disc title.
 */
export function discSavePlan(form: DiscForm): {
  release: Partial<CatalogRelease>;
  disc: Partial<CatalogDisc>;
} {
  const releaseTitle = form.releaseTitle.trim() || 'Untitled Disc';
  const typedNumber = positiveInt(form.discNumber);
  const discCount = Math.max(positiveInt(form.discCount) ?? 1, typedNumber ?? 1);
  const discNumber = typedNumber ?? (discCount > 1 ? null : 1);
  const edition = form.edition.trim() || undefined;
  return {
    release: {
      title: releaseTitle,
      barcode: form.barcode.trim() || undefined,
      edition,
      packaging: discCount > 1 ? 'box_set' : 'case',
      expectedDiscCount: discCount,
    },
    disc: {
      title: discRecordTitle(releaseTitle),
      discNumber: discNumber ?? undefined,
      edition,
      format: form.format,
      isPartOfSet: discCount > 1,
    },
  };
}

/** The lowest disc number a box does not have yet. */
export function nextDiscNumber(discs: Pick<CatalogDisc, 'discNumber'>[]): number {
  const used = new Set(discs.map((d) => d.discNumber).filter((n): n is number => n != null));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

type ReleaseOption = Pick<CatalogRelease, 'id' | 'title'> & { discCount?: number };

const boxNameKey = (name: string) => name.trim().toLowerCase();

/** The boxes whose name is exactly `name`, ignoring case and surrounding spaces. */
export function boxesNamed<T extends { title: string }>(name: string, boxes: T[]): T[] {
  const key = boxNameKey(name);
  return key ? boxes.filter((box) => boxNameKey(box.title ?? '') === key) : [];
}

/**
 * Search for or create the physical Disc catalog record this rip belongs to.
 * The Disc table in my-media-manager's Postgres is the canonical, cross-service
 * disc entity (see backend/api/catalog.py) — disc-ripper-service has no disc
 * identity of its own, it just stores the linked catalog_disc_id on the job.
 *
 * Linking is required: Start Rip stays disabled until a disc is picked or
 * created here, so every ripped file knows the physical disc (and through it
 * the release) it came from.
 *
 * A disc record is two things: the release (the box or case that was bought)
 * and the disc's place in it. The form asks for exactly those. The season and
 * episodes are not disc fields: they are saved with the rip.
 */
export default function DiscCatalogLinkPanel({
  discTitle,
  discType,
  mediaType = 'movie',
  year = 0,
  season = 1,
  volumeLabel,
  linkedDisc,
  onLink,
  onUnlink,
}: {
  /** The movie or show picked above; discs matching it are offered straight away. */
  discTitle: string;
  /** The rip's disc type, used as the new record's default format. */
  discType?: 'dvd' | 'bluray';
  mediaType?: 'movie' | 'show';
  year?: number;
  season?: number;
  /** The disc's own label from the scan, shown as a hint while picking. */
  volumeLabel?: string | null;
  linkedDisc: CatalogDisc | null;
  onLink: (disc: CatalogDisc) => void;
  onUnlink: () => void;
}) {
  // Discs already catalogued under the picked title
  const [matches, setMatches] = useState<CatalogDisc[]>([]);
  const [matching, setMatching] = useState(false);
  const [matchedFor, setMatchedFor] = useState('');

  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState<CatalogDisc[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResults, setBarcodeResults] = useState<CatalogDisc[]>([]);
  const [barcodeSearching, setBarcodeSearching] = useState(false);
  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Details form (new record, or editing the linked one)
  const [formMode, setFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [releaseTitle, setReleaseTitle] = useState('');
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [releaseOptions, setReleaseOptions] = useState<ReleaseOption[]>([]);
  const [discNumber, setDiscNumber] = useState('');
  const [discCount, setDiscCount] = useState('');
  const [edition, setEdition] = useState('');
  const [newFormat, setNewFormat] = useState<DiscFormat | ''>('');
  const format: DiscFormat = newFormat || (discType === 'bluray' ? 'BLURAY' : 'DVD');
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Boxes already in the catalog under exactly the typed name. One is joined
  // without being asked for; several are offered, never guessed between.
  const [boxMatch, setBoxMatch] = useState<{ name: string; boxes: ReleaseOption[] } | null>(null);
  // The user wants a second box with a name the catalog already has.
  const [newBoxAnyway, setNewBoxAnyway] = useState(false);
  const [notice, setNotice] = useState('');
  // Bumped whenever the name changes hands, so a slow lookup cannot overwrite a newer one.
  const boxLookup = useRef(0);

  // The box the linked disc is in, for "Disc 1 of 4".
  const [linkedRelease, setLinkedRelease] = useState<CatalogRelease | null>(null);
  const linkedReleaseId = linkedDisc?.releaseId ?? linkedDisc?.setId ?? null;
  useEffect(() => {
    setLinkedRelease(null);
    if (!linkedReleaseId) return;
    let cancelled = false;
    getRelease(linkedReleaseId).then((release) => { if (!cancelled) setLinkedRelease(release); });
    return () => { cancelled = true; };
  }, [linkedReleaseId, linkedDisc?.title, linkedDisc?.discNumber]);

  // Offer the discs already catalogued under the picked title without making
  // the user type it again.
  useEffect(() => {
    const query = discTitle.trim();
    if (query.length < 2) { setMatches([]); setMatchedFor(''); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setMatching(true);
      const found = await searchDiscs({ title: query });
      if (cancelled) return;
      setMatches(found);
      setMatchedFor(query);
      setMatching(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [discTitle]);

  const runSearch = async (query: string) => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await searchDiscs({ title: query }));
    } finally {
      setSearching(false);
    }
  };

  const handleInputChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 400);
  };

  const runBarcodeSearch = async (query: string) => {
    if (!query.trim()) { setBarcodeResults([]); return; }
    setBarcodeSearching(true);
    try {
      const found = await searchDiscs({ barcode: query.trim() });
      setBarcodeResults(found);
      // A barcode scanner types digits + Enter — an unambiguous match should
      // link immediately rather than making the user click a result.
      if (found.length === 1) onLink(found[0]);
    } finally {
      setBarcodeSearching(false);
    }
  };

  const handleBarcodeInputChange = (value: string) => {
    setBarcodeInput(value);
    if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
    barcodeTimer.current = setTimeout(() => runBarcodeSearch(value), 400);
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
    runBarcodeSearch(barcodeInput);
  };

  // ── Details form ──────────────────────────────────────────────────────────

  // A box already in the catalog: take its size and offer the next free number.
  const applyRelease = async (option: ReleaseOption, lookup: number) => {
    setReleaseId(option.id);
    const release = await getRelease(option.id);
    if (!release || lookup !== boxLookup.current) return;
    const discs = release.discs ?? [];
    const count = release.expectedDiscCount ?? discs.length;
    if (count) setDiscCount(String(Math.max(count, discs.length + 1)));
    const fromLabel = discNumberFromLabel(volumeLabel);
    const taken = discs.some((d) => d.discNumber === fromLabel);
    setDiscNumber(String(fromLabel && !taken ? fromLabel : nextDiscNumber(discs)));
    if (release.edition) setEdition(release.edition);
  };

  /**
   * Look for boxes with exactly this name. Exactly one is joined, the same as
   * picking it from the list; with several the user has to choose.
   */
  const matchBoxByName = async (name: string): Promise<ReleaseOption[]> => {
    const lookup = ++boxLookup.current;
    if (!boxNameKey(name)) { setBoxMatch(null); return []; }
    const boxes = boxesNamed(name, await searchBoxes(name));
    if (lookup !== boxLookup.current) return boxes;
    setBoxMatch({ name: boxNameKey(name), boxes });
    if (boxes.length === 1) await applyRelease(boxes[0], lookup);
    return boxes;
  };

  const resetDiscPlace = () => {
    setDiscNumber(String(discNumberFromLabel(volumeLabel) ?? ''));
    setDiscCount('');
    setEdition('');
  };

  const openCreate = () => {
    const suggested = suggestReleaseTitle(mediaType, discTitle || searchInput, year, season);
    setError('');
    setNotice('');
    setReleaseId(null);
    setReleaseTitle(suggested);
    resetDiscPlace();
    setBoxMatch(null);
    setNewBoxAnyway(false);
    setFormMode('create');
    // The suggested name is often a box that is already there (disc 2 of a season).
    void matchBoxByName(suggested);
  };

  const makeNewBoxInstead = () => {
    boxLookup.current++;
    setNotice('');
    setNewBoxAnyway(true);
    setReleaseId(null);
    resetDiscPlace();
  };

  const joinExistingBox = (box: ReleaseOption) => {
    setNotice('');
    setNewBoxAnyway(false);
    void applyRelease(box, ++boxLookup.current);
  };

  const openEdit = () => {
    if (!linkedDisc) return;
    setError('');
    const loose = !linkedRelease || linkedRelease.packaging === 'loose';
    setReleaseId(linkedReleaseId);
    setReleaseTitle(linkedRelease?.title ?? linkedDisc.title);
    setDiscNumber(linkedDisc.discNumber != null ? String(linkedDisc.discNumber) : '');
    const count = linkedRelease?.expectedDiscCount ?? (loose ? null : linkedRelease?.discs?.length ?? null);
    setDiscCount(count ? String(count) : '');
    setEdition(linkedDisc.edition ?? linkedRelease?.edition ?? '');
    setNewFormat(linkedDisc.format ?? '');
    setFormMode('edit');
  };

  const handleReleaseInput = (value: string, reason: string) => {
    setReleaseTitle(value);
    if (formMode !== 'create') return;
    const typed = reason === 'input' || reason === 'clear';
    if (typed) {
      // A typed name is a new box unless the catalog has a box with exactly
      // that name, which the lookup below finds (a rename, when editing).
      boxLookup.current++;
      setReleaseId(null);
      setBoxMatch(null);
      setNewBoxAnyway(false);
      setNotice('');
    }
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(async () => {
      if (typed) void matchBoxByName(value);
      setReleaseOptions(await searchReleases(value));
    }, 300);
  };

  // Picked from the list: the box is joined, whatever else shares its name.
  const pickRelease = async (option: ReleaseOption) => {
    setNotice('');
    setNewBoxAnyway(false);
    setReleaseTitle(option.title);
    setBoxMatch((current) => (
      current?.name === boxNameKey(option.title) && current.boxes.some((b) => b.id === option.id)
        ? current
        : { name: boxNameKey(option.title), boxes: [option] }
    ));
    await applyRelease(option, ++boxLookup.current);
  };

  // What the catalog already has under the name as it is typed right now.
  const namedBoxes = formMode === 'create' && boxMatch?.name === boxNameKey(releaseTitle) ? boxMatch.boxes : [];
  const joinedBox = formMode === 'create' && releaseId
    ? namedBoxes.find((box) => box.id === releaseId) ?? null
    : null;
  // Several boxes share the name and none is chosen: saving would be a guess.
  const mustChooseBox = formMode === 'create' && !releaseId && !newBoxAnyway && namedBoxes.length > 1;
  const describeBox = (box: ReleaseOption) =>
    box.discCount != null ? `${box.discCount} disc${box.discCount === 1 ? '' : 's'} so far` : '';

  const plan = discSavePlan({
    releaseTitle, releaseId, discNumber, discCount, edition, format, barcode: barcodeInput,
  });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      if (formMode === 'edit' && linkedDisc) {
        // Naming the packaging is what turns the automatic one-disc wrapper
        // of a loose disc into a box other discs can join.
        const keepPackaging = !!linkedRelease?.packaging && linkedRelease.packaging !== 'loose';
        let targetReleaseId = linkedReleaseId;
        if (targetReleaseId) {
          await updateRelease(targetReleaseId, {
            title: plan.release.title,
            edition: plan.release.edition ?? null,
            expectedDiscCount: plan.release.expectedDiscCount,
            packaging: keepPackaging ? linkedRelease?.packaging : plan.release.packaging,
          });
        } else {
          targetReleaseId = (await createRelease({ ...plan.release, discs: [] })).id;
        }
        onLink(await mergeDisc(linkedDisc.id, {
          ...plan.disc,
          edition: plan.disc.edition ?? null,
          discNumber: plan.disc.discNumber ?? null,
          setId: targetReleaseId,
        }));
      } else if (releaseId) {
        // The barcode stays on the box: a box's discs share it.
        onLink(await createDisc({ ...plan.disc, setId: releaseId, isPartOfSet: true }));
      } else if (!newBoxAnyway && (await matchBoxByName(releaseTitle)).length > 0) {
        // The catalog has this box (the lookup had not answered when Create
        // was pressed, or the box is new since). It is now filled in above:
        // nothing is saved until the user has seen it.
        setNotice(
          'A box with this name is already in your catalog. Check the box and disc number above, '
          + 'then press Create and Link again.',
        );
        return;
      } else {
        const release = await createRelease({ ...plan.release, discs: [plan.disc] });
        const disc = release.discs?.[0];
        if (!disc) throw new Error('The disc record was not created');
        onLink(disc);
      }
      setFormMode('closed');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save the disc record');
    } finally {
      setSaving(false);
    }
  };

  const detailsForm = (
    <Box sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <Autocomplete
          freeSolo
          size="small"
          sx={{ flex: '3 1 300px' }}
          options={formMode === 'create' ? releaseOptions : []}
          getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.title)}
          filterOptions={(x) => x}
          inputValue={releaseTitle}
          onInputChange={(_, value, reason) => handleReleaseInput(value, reason)}
          onChange={(_, value) => { if (value && typeof value !== 'string') pickRelease(value); }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Name on the box"
              helperText={
                joinedBox ? (
                  <>
                    “{joinedBox.title}” is a box already in your catalog
                    {describeBox(joinedBox) ? ` (${describeBox(joinedBox)})` : ''}: this disc will be added to
                    it.{' '}
                    <Link component="button" type="button" variant="caption" onClick={makeNewBoxInstead}>
                      Make a new box instead
                    </Link>
                  </>
                ) : mustChooseBox ? (
                  `${namedBoxes.length} boxes in your catalog have this name. Choose the one this disc belongs to below.`
                ) : newBoxAnyway && namedBoxes.length > 0 ? (
                  <>
                    A new box will be made with a name your catalog already has.{' '}
                    {namedBoxes.length === 1 && (
                      <Link component="button" type="button" variant="caption" onClick={() => joinExistingBox(namedBoxes[0])}>
                        Add to the existing box instead
                      </Link>
                    )}
                  </>
                ) : mediaType === 'show'
                  ? 'As printed on the case, e.g. “Burn Notice: The Complete First Season”. One name for the whole box.'
                  : 'As printed on the case, e.g. “Alien (1979)” or “Alien Anthology”.'
              }
            />
          )}
        />
        <TextField
          size="small"
          label="Disc"
          type="number"
          value={discNumber}
          onChange={(e) => setDiscNumber(e.target.value)}
          sx={{ width: 80 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
        <TextField
          size="small"
          label="of (discs in box)"
          type="number"
          placeholder="1"
          value={discCount}
          onChange={(e) => setDiscCount(e.target.value)}
          sx={{ width: 140 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
        <TextField
          select
          size="small"
          label="Format"
          value={format}
          onChange={(e) => setNewFormat(e.target.value as DiscFormat)}
          sx={{ width: 170 }}
        >
          {FORMAT_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </TextField>
      </Stack>
      {formMode === 'create' && namedBoxes.length > 1 && (
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          <Typography variant="caption">Boxes with this name:</Typography>
          {namedBoxes.map((box) => (
            <Chip
              key={box.id}
              label={[box.title, describeBox(box)].filter(Boolean).join(' · ')}
              size="small"
              clickable
              color="primary"
              variant={releaseId === box.id ? 'filled' : 'outlined'}
              onClick={() => joinExistingBox(box)}
            />
          ))}
          {!newBoxAnyway && !releaseId && (
            <Button size="small" onClick={makeNewBoxInstead}>Make a new box instead</Button>
          )}
        </Stack>
      )}
      {notice && <Alert severity="info" sx={{ mt: 1, py: 0 }}>{notice}</Alert>}
      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <TextField
          size="small"
          label="Special version (optional)"
          placeholder="Director's Cut"
          value={edition}
          onChange={(e) => setEdition(e.target.value)}
          helperText="Only when the box says so: Director's Cut, Extended Edition, Collector's Edition. Otherwise leave blank."
          sx={{ flex: '1 1 300px' }}
        />
        <Button
          variant="contained"
          size="small"
          disabled={saving || !releaseTitle.trim() || mustChooseBox}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
          onClick={handleSave}
          sx={{ mt: 0.25 }}
        >
          {saving ? 'Saving…' : formMode === 'edit' ? 'Save' : 'Create and Link'}
        </Button>
        <Button size="small" onClick={() => setFormMode('closed')} sx={{ mt: 0.25 }}>Cancel</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
        This disc will be saved as “{plan.disc.title}”
        {plan.disc.discNumber && plan.disc.isPartOfSet ? ` (disc ${plan.disc.discNumber})` : ''}
        {formMode === 'create' && releaseId ? ', added to the box already in your catalog' : ''}.
        {formMode === 'create' && !releaseId && barcodeInput.trim() ? ' The barcode above is saved on the box.' : ''}
        {mediaType === 'show'
          ? ' The season and episodes are not typed here: they are saved with the rip, from the season and titles you pick on this page.'
          : ''}
      </Typography>
    </Box>
  );

  // ── Linked ────────────────────────────────────────────────────────────────

  if (linkedDisc) {
    const count = linkedRelease?.packaging === 'loose' ? null : linkedRelease?.expectedDiscCount;
    const looseInBox = mediaType === 'show' && linkedRelease?.packaging === 'loose';
    return (
      <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2">Linked to disc:</Typography>
            <Chip label={linkedDisc.title} size="small" color="primary" />
            {linkedDisc.discNumber != null && (
              <Typography variant="caption" color="text.secondary">
                Disc {linkedDisc.discNumber}{count && count > 1 ? ` of ${count}` : ''}
              </Typography>
            )}
            {linkedDisc.edition && (
              <Typography variant="caption" color="text.secondary">{linkedDisc.edition}</Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Button size="small" onClick={formMode === 'edit' ? () => setFormMode('closed') : openEdit}>
              {formMode === 'edit' ? 'Close' : 'Edit details'}
            </Button>
            <Button size="small" onClick={() => { setFormMode('closed'); onUnlink(); }}>Unlink</Button>
          </Stack>
        </Stack>
        {looseInBox && formMode !== 'edit' && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            This disc is catalogued on its own. If it came in a box with other discs, use Edit details to
            say how many, so the others can be added to the same box.
          </Typography>
        )}
        <Collapse in={formMode === 'edit'} unmountOnExit>{detailsForm}</Collapse>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Paper>
    );
  }

  // ── Not linked ────────────────────────────────────────────────────────────

  const knownTitle = matchedFor && matchedFor === discTitle.trim();
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Which physical disc is this? (required)
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
        Every rip is tied to a disc in your catalog, so each file knows the disc and box it came from.
        {volumeLabel ? ` The disc in the drive calls itself “${volumeLabel}”.` : ''}
      </Typography>

      {/* Discs already catalogued under the title picked above */}
      {matching && <CircularProgress size={14} sx={{ mb: 1 }} />}
      {knownTitle && matches.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
            Already in your catalog for “{matchedFor}” — click the one in the drive:
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {matches.map((disc) => (
              <Chip
                key={disc.id}
                label={describeCatalogDisc(disc)}
                variant="outlined"
                color="primary"
                clickable
                onClick={() => onLink(disc)}
              />
            ))}
          </Stack>
        </Box>
      )}
      {knownTitle && !matching && matches.length === 0 && (
        <Alert severity="info" sx={{ mb: 1.5, py: 0 }}>
          No disc in your catalog is named “{matchedFor}” yet. Add this one with “New disc record”,
          or find it by barcode or another name below.
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <TextField
          size="small"
          label="Scan or type barcode"
          value={barcodeInput}
          inputMode="numeric"
          onChange={(e) => handleBarcodeInputChange(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
          sx={{ minWidth: 200 }}
          slotProps={{
            input: {
              endAdornment: barcodeSearching ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />
        <Autocomplete
          size="small"
          sx={{ minWidth: 260, flex: '1 1 260px' }}
          options={results}
          loading={searching}
          noOptionsText={searchInput.trim() ? 'No disc with that name' : 'Type a disc or box name'}
          getOptionLabel={(opt) => describeCatalogDisc(opt)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(x) => x}
          inputValue={searchInput}
          onInputChange={(_, value) => handleInputChange(value)}
          onChange={(_, value) => { if (value) onLink(value); }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search your catalog by name"
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searching && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                },
              }}
            />
          )}
        />
        <Button
          variant={knownTitle && matches.length === 0 ? 'contained' : 'outlined'}
          size="small"
          onClick={formMode === 'create' ? () => setFormMode('closed') : openCreate}
          sx={{ mt: 0.5 }}
        >
          {formMode === 'create' ? 'Cancel new record' : 'New disc record'}
        </Button>
      </Stack>
      {barcodeResults.length > 1 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {barcodeResults.map((disc) => (
            <Chip
              key={disc.id}
              label={describeCatalogDisc(disc)}
              size="small"
              variant="outlined"
              clickable
              onClick={() => onLink(disc)}
            />
          ))}
        </Stack>
      )}
      <Collapse in={formMode === 'create'} unmountOnExit>{detailsForm}</Collapse>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Paper>
  );
}
