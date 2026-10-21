'use client';

import React, { useEffect } from 'react';
import { Stack } from '@mui/material';
import { createDisc, updateDisc } from '@/service/catalog/DiscCatalogService';
import { lookupUpc, scanCover } from '@/service/catalog/DiscLookupService';
import { CatalogDisc } from '@/types/catalog/Disc.type';
import {
  FormCheckbox, FormDialog, FormSelectField, FormTextField, useZodForm,
} from '@/components/form';
import {
  DISC_CONDITIONS, DISC_FORMATS, DISC_REGIONS, DiscFormOutput, discFormSchema, toDiscFormValues, toDiscPayload,
} from './discFormSchema';

const toOptions = (values: readonly string[]) => values.map((value) => ({ value }));
const FORMAT_OPTIONS = toOptions(DISC_FORMATS);
const CONDITION_OPTIONS = toOptions(DISC_CONDITIONS);
const REGION_OPTIONS = toOptions(DISC_REGIONS);

// Fields a barcode lookup or cover scan can suggest.
type Suggestion = { title?: string; format?: DiscFormat; releaseDate?: string };
type SuggestionKey = keyof Suggestion;
const SUGGESTION_LABELS: Record<SuggestionKey, string> = {
  title: 'Title', format: 'Format', releaseDate: 'Release date',
};

function asFormat(value?: string | null): DiscFormat | undefined {
  return FORMATS.find((f) => f === value);
}

export default function DiscEditDialog({
  open,
  disc,
  onClose,
  onSaved,
}: {
  open: boolean;
  disc?: CatalogDisc | null;
  onClose: () => void;
  onSaved: (disc: CatalogDisc) => void;
}) {
  const isEdit = !!disc;
  const form = useZodForm(discFormSchema, { defaultValues: toDiscFormValues(disc) });
  const { reset } = form;

  useEffect(() => {
    if (open) reset(toDiscFormValues(disc));
  }, [open, disc, reset]);

  const handleSave = async (values: DiscFormOutput) => {
    const payload = toDiscPayload(values);
    const saved = isEdit
      ? await updateDisc(disc!.id, payload)
      : await createDisc(payload);
    onSaved(saved);
    onClose();
  };

  return (
    <FormDialog
      open={open}
      title={isEdit ? 'Edit Disc' : 'New Disc'}
      form={form}
      onSubmit={handleSave}
      onClose={onClose}
      submitLabel={isEdit ? 'Save Changes' : 'Create Disc'}
      submitErrorFallback="Failed to save disc"
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <FormTextField name="title" label="Title" required fullWidth autoFocus />
        <Stack direction="row" spacing={2}>
          <FormSelectField name="format" label="Format" options={FORMAT_OPTIONS} emptyLabel="None" fullWidth size="small" />
          <FormSelectField name="condition" label="Condition" options={CONDITION_OPTIONS} emptyLabel="None" fullWidth size="small" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <FormTextField name="barcode" label="Barcode" fullWidth size="small" slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
          <FormSelectField name="regionCode" label="Region Code" options={REGION_OPTIONS} emptyLabel="None" fullWidth size="small" />
          <FormTextField name="discNumber" label="Disc #" type="number" sx={{ width: 100, flexShrink: 0 }} size="small" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <FormTextField name="language" label="Language" fullWidth size="small" />
          <FormTextField
            name="purchaseDate" label="Purchase Date" type="date" fullWidth size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <FormTextField
            name="releaseDate" label="Release Date" type="date" fullWidth size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <FormCheckbox name="isPartOfSet" label="Part of a set" />
          <FormCheckbox name="isRentalDisc" label="Rental disc" />
          <FormCheckbox name="containsSpecialFeatures" label="Contains special features" />
        </Stack>
      </Stack>
    </FormDialog>
  );
}
