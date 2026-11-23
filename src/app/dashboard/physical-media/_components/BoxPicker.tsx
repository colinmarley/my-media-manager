'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, TextField, Typography } from '@mui/material';
import { ReleaseOption, searchBoxes } from '@/service/catalog/DiscCatalogService';

/** The box a disc is in: one already catalogued (`id` set), or a new one to create by name. */
export interface BoxChoice {
  id: string | null;
  title: string;
}

function discCountLabel(count: number | undefined): string {
  if (count == null) return '';
  if (count === 0) return 'no discs yet';
  return count === 1 ? '1 disc' : `${count} discs`;
}

/**
 * Picks the box set a disc belongs to. Choosing a listed box joins it; typing
 * a name that is not listed makes a new box on save; clearing the field takes
 * the disc out of its box.
 */
export default function BoxPicker({
  value,
  onChange,
  disabled,
}: {
  value: BoxChoice | null;
  onChange: (value: BoxChoice | null) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<ReleaseOption[]>([]);
  const [input, setInput] = useState(value?.title ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    setInput(value?.title ?? '');
  }, [value?.id, value?.title]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    if (!text.trim()) { setOptions([]); return; }
    timer.current = setTimeout(async () => {
      const found = await searchBoxes(text);
      if (mine === seq.current) setOptions(found);
    }, 300);
  };

  const isNew = !!value && !value.id;

  return (
    <Autocomplete<ReleaseOption, false, false, true>
      freeSolo
      disabled={disabled}
      options={options}
      filterOptions={(all) => all}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.title)}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      value={value?.id ? { id: value.id, title: value.title } : null}
      inputValue={input}
      onInputChange={(_e, text, reason) => {
        setInput(text);
        if (reason === 'input') {
          search(text);
          // Typed text names a new box until a listed one is picked.
          onChange(text.trim() ? { id: null, title: text } : null);
        } else if (reason === 'clear') {
          setOptions([]);
          onChange(null);
        }
      }}
      onChange={(_e, picked) => {
        if (picked && typeof picked !== 'string') onChange({ id: picked.id, title: picked.title });
      }}
      renderOption={(props, option) => {
        // MUI passes a title-based key in props; two boxes can share a title.
        const rest = { ...props } as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
        delete rest.key;
        return (
          <li {...rest} key={option.id}>
            <span>{option.title}</span>
            {discCountLabel(option.discCount) && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {discCountLabel(option.discCount)}
              </Typography>
            )}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Box set"
          size="small"
          placeholder="Not in a box"
          helperText={
            isNew
              ? `A new box named “${value!.title.trim()}” will be created.`
              : 'The box this disc came in. Discs in the same box share it.'
          }
        />
      )}
    />
  );
}
