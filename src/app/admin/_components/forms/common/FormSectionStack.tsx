import React from 'react';
import { Stack } from '@mui/material';

interface FormSectionStackProps {
  children: React.ReactNode;
}

const FormSectionStack: React.FC<FormSectionStackProps> = ({ children }) => {
  return <Stack spacing={2.5}>{children}</Stack>;
};

export default FormSectionStack;
