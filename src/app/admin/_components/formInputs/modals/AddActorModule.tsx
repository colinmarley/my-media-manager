import React, { useState } from 'react';
import FirestoreService from '@/service/firebase/FirestoreService';
import { ActorInitialEntry } from '@/types/collections/Actor.type';
import { TextField, Button, Box, Modal, Typography } from '@mui/material';
import useFormStore from '@/store/useFormStore';

interface AddActorModuleProps {
  onClose: () => void;
}

const AddActorModule: React.FC<AddActorModuleProps> = () => {
  const { closeAddActorModal, refreshActorOptions } = useFormStore();

  const [formData, setFormData] = useState<ActorInitialEntry>({
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
    const firestoreService = new FirestoreService('actors');
    await firestoreService.addDocument(formData);
    refreshActorOptions();
    closeAddActorModal();
  };

  return (
    <Modal open onClose={closeAddActorModal}>
      <Box
        sx={Styles.modalBox}
      >
        <Typography variant="h6" component="h2" gutterBottom>
          Add Actor
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
            <Button onClick={closeAddActorModal} color="secondary">
              Cancel
            </Button>
            <Button type="submit" variant="contained">
              Add Actor
            </Button>
          </Box>
        </form>
      </Box>
    </Modal>
  );
};

const Styles = {
    modalBox: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 400,
        bgcolor: 'background.paper',
        boxShadow: 24,
        p: 4,
        borderRadius: 2,
    },
};

export default AddActorModule;