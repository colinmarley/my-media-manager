import React from 'react';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { FormInputData } from '@/types/inputs/FormInput.type';
import useFormStore from '@/store/useFormStore';

interface WritersInputProps {
  writers: FormInputData<string[]>;
  setWriters: (writers: string[]) => void;
}

const WritersInput: React.FC<WritersInputProps> = ({ writers, setWriters }) => {
  const { writerOptions, openAddWriterModal, refreshWriterOptions } = useFormStore();
  const [pendingWriterName, setPendingWriterName] = React.useState('');

  React.useEffect(() => {
    void refreshWriterOptions();
  }, [refreshWriterOptions]);

  const handleAddWriter = () => {
    const nextWriter = pendingWriterName.trim();
    if (!nextWriter) {
      return;
    }
    if (writers.value.includes(nextWriter)) {
      setPendingWriterName('');
      return;
    }
    setWriters([...writers.value, nextWriter]);
    setPendingWriterName('');
  };

  const handleRemoveWriter = (writerName: string) => {
    setWriters(writers.value.filter((writer) => writer !== writerName));
  };

  return (
    <Grid size={3}>
        <Grid container spacing={2}>
            <Grid size={12}>
                <Autocomplete
                  freeSolo
                    options={writerOptions}
                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label || ''}
                  inputValue={pendingWriterName}
                  onInputChange={(event, value) => {
                    setPendingWriterName(value);
                  }}
                    onChange={(event, value) => {
                        if (!value) {
                            return;
                        }
                        if (typeof value === 'string') {
                            setPendingWriterName(value);
                            return;
                        }
                        if (value.id === 'new') {
                            openAddWriterModal();
                            return;
                        }
                        setPendingWriterName(value.label);
                    }}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Writer Name"
                            sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                            fullWidth
                            error={writers?.errors.length > 0}
                            helperText={writers?.errors.join('\n')}
                        />
                    )}
                />
            </Grid>
            <Grid size={12}>
                <Button onClick={handleAddWriter} variant="contained" color="primary">
                Add Writer
                </Button>
            </Grid>
            <Grid size={12}>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {writers.value.map((writer) => (
                        <Chip
                            key={writer}
                            label={writer}
                            onDelete={() => handleRemoveWriter(writer)}
                            color="primary"
                            variant="outlined"
                        />
                    ))}
                </Stack>
            </Grid>
        </Grid>
    </Grid>
  );
};

export default WritersInput;