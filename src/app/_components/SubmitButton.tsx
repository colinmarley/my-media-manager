import React from 'react';
import Button from '@mui/material/Button';

interface SubmitButtonProps {
  onClick: (e: React.FormEvent) => void;
  disabled?: boolean;
  label?: string;
}

const SubmitButton: React.FC<SubmitButtonProps> = ({ onClick, disabled = false, label = 'Submit' }) => {
  return (
    <Button
      type="submit"
      variant="contained"
      color="primary"
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </Button>
  );
};

export default SubmitButton;