import React, { useState } from 'react';
import CatalogService from '@/service/catalog/CatalogService';
import { TextField, Button, Box, Modal, Typography } from '@mui/material';
import useFormStore from '@/store/useFormStore';

interface WriterInitialEntry {
  fullName: string;
  movieIds: string[];
  seriesIds: string[];
  birthplace: string;
  birthday: string;
  notes: string;
}

const AddWriterModule: React.FC = () => {
  const { closeAddWriterModal, refreshWriterOptions } = useFormStore();

  const [formData, setFormData] = useState<WriterInitialEntry>({
    fullName: '',
    movieIds: [],
    seriesIds: [],
    birthplace: '',
    birthday: '',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const catalogService = new CatalogService('writers');
    await catalogService.addDocument(formData);
    await refreshWriterOptions();
    closeAddWriterModal();
  };

  return (
    <Modal open onClose={closeAddWriterModal}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 400,
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 4,
          borderRadius: 2,
        }}
      >
        <Typography variant="h6" component="h2" gutterBottom>
          Add Writer
        </Typography>
        <form onSubmit={handleSubmit}>
          <TextField
            label="Full Name"
            name="fullName"
            value={formData.fullName}
            onChange={handleChange}
            fullWidth
            required
            margin="normal"
          />
          <TextField
            label="Birthplace"
            name="birthplace"
            value={formData.birthplace}
            onChange={handleChange}
            fullWidth
            margin="normal"
          />
          <TextField
            label="Birthday"
            name="birthday"
            value={formData.birthday}
            onChange={handleChange}
            fullWidth
            margin="normal"
          />
          <TextField
            label="Notes"
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            fullWidth
            multiline
            rows={4}
            margin="normal"
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
            <Button onClick={closeAddWriterModal} color="secondary">
              Cancel
            </Button>
            <Button type="submit" variant="contained">
              Add Writer
            </Button>
          </Box>
        </form>
      </Box>
    </Modal>
  );
};

export default AddWriterModule;
