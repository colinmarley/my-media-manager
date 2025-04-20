import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark', // Default mode
    background: {
      default: '#121212', // Dark background
      paper: '#1e1e1e', // Slightly lighter background for paper
    },
    primary: {
      main: '#3d5afe', // Indigo color for primary buttons
      contrastText: '#ffffff', // White text for contrast
    },
    secondary: {
      main: '#03a9f4', // Bright blue for secondary buttons
      contrastText: '#ffffff', // White text for contrast
    },
  },
  typography: {
    fontFamily: 'Roboto, Arial, sans-serif', // Default Material-UI font
    h1: {
      fontSize: '32px',
      lineHeight: '40px',
      fontWeight: 700,
      letterSpacing: '-0.02em',
      textAlign: 'center',
      color: '#ffffff',
    },
    body1: {
      fontSize: '14px',
      lineHeight: '24px',
      letterSpacing: '-0.01em',
      color: '#e0e0e0', // Light gray for body text
    },
    button: {
      fontSize: '16px',
      fontWeight: 600,
      lineHeight: '20px',
      textTransform: 'uppercase', // Make button text uppercase
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: '8px', // Slightly rounded corners
          height: '48px',
          padding: '0 24px',
          transition: 'background 0.3s, color 0.3s, box-shadow 0.3s',
          textTransform: 'none', // Disable uppercase text
          boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.3)', // Subtle shadow for buttons
          '&:hover': {
            boxShadow: '0px 6px 10px rgba(0, 0, 0, 0.5)', // Stronger shadow on hover
          },
        },
        containedPrimary: {
          backgroundColor: '#3d5afe', // Indigo color
          color: '#ffffff', // White text
          '&:hover': {
            backgroundColor: '#304ffe', // Darker indigo on hover
          },
        },
        containedSecondary: {
          backgroundColor: '#03a9f4', // Bright blue
          color: '#ffffff', // White text
          '&:hover': {
            backgroundColor: '#0288d1', // Darker blue on hover
          },
        },
        outlinedPrimary: {
          borderColor: '#3d5afe', // Indigo border
          color: '#3d5afe', // Indigo text
          '&:hover': {
            backgroundColor: 'rgba(61, 90, 254, 0.1)', // Light indigo background on hover
          },
        },
        outlinedSecondary: {
          borderColor: '#03a9f4', // Blue border
          color: '#03a9f4', // Blue text
          '&:hover': {
            backgroundColor: 'rgba(3, 169, 244, 0.1)', // Light blue background on hover
          },
        },
      },
    },
  },
});

export default theme;