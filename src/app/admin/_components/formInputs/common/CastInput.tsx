import React from 'react';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid2';
import { ActorPreview } from '@/types/collections/Common.type';
import { FormInputData } from '@/types/inputs/FormInput.type';

interface CastInputProps {
  cast: FormInputData<ActorPreview[]>;
  setCast: (cast: ActorPreview[]) => void;
  setShowModal: (show: boolean) => void;
}

const CastInput: React.FC<CastInputProps> = ({ cast, setCast, setShowModal }) => {
  const handleActorChange = (index: number, value: string) => {
    const newCast = [...cast?.value];
    newCast[index].name = value;
    setCast(newCast);
  };

  const handleRemoveCastMember = (index: number) => {
    const newCast = [...cast?.value];
    newCast.splice(index, 1);
    setCast(newCast);
  }

  const handleCharactersChange = (index: number, value: string) => {
    const newCast = [...cast?.value];
    value.split(", ").map((val: string) => { return newCast[index].characters.push(val) });
    setCast(newCast);
  };

  const handleChangeActorId = (index: number, value: string) => {
    const newCast = [...cast?.value];
    newCast[index].actorId = value;
    setCast(newCast);
  }

  const handleAddCast = () => {
    setCast([...cast?.value, { name: '', characters: [], actorId: ''}]);
  };

  const getErrorsForActorName = (index: number) => {
    const nameErrors = cast?.errors.filter(
      (error) => error.split(":")[0] === index.toString() && error.split(":")[1] === 'name'
    );
    return nameErrors.length > 0 ? nameErrors.map((err) => err.split(":")[2]).join("\n") : [];
  }

  const getErrorsForCharacters = (index: number) => {
    const characterErrors = cast?.errors.filter(
      (error) => error.split(":")[0] === index.toString() && error.split(":")[1] === 'characters'
    );
    return characterErrors.length > 0 ? characterErrors.map(err => err.split(":")[2]).join(`\n`) : [];
  }

  const getErrorsForActorId = (index: number) => {
    const actorIdErrors = cast?.errors.filter(
      (error) => error.split(":")[0] === index.toString() && error.split(":")[1] === 'actorId'
    );
    return actorIdErrors.length > 0 ? actorIdErrors.map(err => err.split(":")[2]).join(`\n`) : [];
  }

  return (
    <Grid size={5}>
        <Grid container spacing={2}>
            {cast?.value.map((entry, index) => {
                const nameErrorList = getErrorsForActorName(index);
                const characterErrorList = getErrorsForCharacters(index);
                const actorIdErrorList = getErrorsForActorId(index);
                return (<React.Fragment key={index}>
                <Grid size={3}>
                    <TextField
                    label={`Actor ${index + 1}`}
                    value={entry.name}
                    onChange={(e) => handleActorChange(index, e.target.value)}
                    fullWidth
                    required
                    error={!!(nameErrorList && nameErrorList.length > 0)}
                    helperText={nameErrorList}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                <Grid size={4}>
                    <TextField
                    label={`Characters ${index + 1}`}
                    value={entry.characters.forEach((val: string) => { return val + ", " })}
                    onChange={(e) => handleCharactersChange(index, e.target.value)}
                    fullWidth
                    required
                    error={!!(characterErrorList && characterErrorList.length > 0)}
                    helperText={characterErrorList}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                <Grid size={3}>
                    <TextField
                    label={`Actor ID ${index + 1}`}
                    value={entry.actorId}
                    onChange={(e) => handleChangeActorId(index, e.target.value)}
                    fullWidth
                    required
                    error={!!(actorIdErrorList && actorIdErrorList.length > 0)}
                    helperText={actorIdErrorList}
                    sx={{ input: { color: 'white' }, label: { color: 'white' } }}
                    />
                </Grid>
                <Grid size={2}>
                  <Button onClick={() => handleRemoveCastMember(index)} variant="contained" color="secondary">
                    Remove
                  </Button>
                </Grid>
                </React.Fragment>
                );})}
            <Grid size={12}>
                <Button onClick={handleAddCast} variant="contained" color="primary">
                Add  Cast
                </Button>
            </Grid>
        </Grid>
        <Button onClick={() => setShowModal(true)} variant="contained" color="primary">
            Add Actor Modal
        </Button>
    </Grid>
  );
};

export default CastInput;