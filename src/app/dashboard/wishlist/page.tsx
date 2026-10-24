'use client';

/**
 * /dashboard/wishlist — the web counterpart of the mobile app's wishlist.
 * Lists items oldest first (the order GET /api/wishlist returns), adds via
 * WishlistAddDialog and removes after a confirm through the shared
 * NotificationProvider. See backend/api/wishlist.py.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, IconButton, List, ListItem, ListItemText, Paper, Stack, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useConfirm, useNotify } from '@/context/NotificationContext';
import { deleteWishlistItem, listWishlist } from '@/service/catalog/WishlistService';
import { WishlistItem } from '@/types/catalog/Wishlist.type';
import WishlistAddDialog from './_components/WishlistAddDialog';

function describeItem(item: WishlistItem): string {
  return [item.format, item.year, item.barcode, item.imdbId].filter(Boolean).join(' · ');
}

export default function WishlistPage() {
  const notify = useNotify();
  const confirm = useConfirm();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setItems(await listWishlist());
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load wishlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (item: WishlistItem) => {
    const ok = await confirm({
      title: 'Remove from wishlist?',
      message: `"${item.title}" will be removed from your wishlist.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deleteWishlistItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      notify(`Removed "${item.title}"`, 'success');
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'Failed to remove wishlist item', 'error');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4">Wishlist</Typography>
        <Button variant="contained" onClick={() => setAddOpen(true)}>Add</Button>
      </Stack>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Titles you want but don&apos;t own yet, oldest first.
      </Typography>

      {loading && <CircularProgress />}
      {!loading && loadError && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={load}>Retry</Button>}>
          {loadError}
        </Alert>
      )}
      {!loading && !loadError && items.length === 0 && (
        <Typography color="text.secondary">Your wishlist is empty.</Typography>
      )}
      {!loading && !loadError && items.length > 0 && (
        <Paper variant="outlined">
          <List aria-label="Wishlist items">
            {items.map((item) => (
              <ListItem
                key={item.id}
                divider
                secondaryAction={(
                  <IconButton edge="end" aria-label={`Remove ${item.title}`} onClick={() => handleRemove(item)}>
                    <DeleteIcon />
                  </IconButton>
                )}
              >
                <ListItemText
                  primary={item.title}
                  secondary={[describeItem(item), item.notes].filter(Boolean).join(' — ') || undefined}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <WishlistAddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(item) => {
          setItems((prev) => [...prev, item]);
          notify(`Added "${item.title}" to your wishlist`, 'success');
        }}
      />
    </Box>
  );
}
