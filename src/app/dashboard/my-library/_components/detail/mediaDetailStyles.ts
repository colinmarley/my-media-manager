/** Shared section styling for the library media details screen. */
export const styles = {
  page: {
    minHeight: '100vh',
    p: { xs: 2, md: 3 },
    background: 'radial-gradient(circle at 85% 10%, rgba(112, 182, 239, 0.2), transparent 50%), linear-gradient(145deg, #0f1519 0%, #15252f 50%, #1a2f3c 100%)',
    color: '#f7fbff'
  },
  backButton: {
    mb: 2,
    color: '#cde7ff'
  },
  posterCard: {
    p: 1.5,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  poster: {
    width: '100%',
    borderRadius: 1.5,
    maxHeight: 640,
    objectFit: 'cover'
  },
  posterSourceInput: {
    '& .MuiInputBase-input': {
      color: '#f7fbff',
    },
    '& .MuiInputLabel-root': {
      color: 'rgba(205, 229, 250, 0.78)',
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: '#70b6ef',
    },
    '& .MuiOutlinedInput-root': {
      '& fieldset': {
        borderColor: 'rgba(148, 188, 214, 0.3)',
      },
      '&:hover fieldset': {
        borderColor: 'rgba(148, 188, 214, 0.5)',
      },
      '&.Mui-focused fieldset': {
        borderColor: '#70b6ef',
      },
    },
  },
  sectionCard: {
    p: 2,
    borderRadius: 2,
    border: '1px solid rgba(148, 188, 214, 0.25)',
    backgroundColor: 'rgba(9, 16, 20, 0.8)'
  },
  title: {
    fontWeight: 700,
    mb: 1
  },
  chipRow: {
    mb: 1.5,
    flexWrap: 'wrap'
  },
  divider: {
    borderColor: 'rgba(190, 219, 245, 0.24)',
    mb: 1.5
  },
  metaLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600
  },
  sectionTitle: {
    mb: 1,
    fontWeight: 700
  },
  preBlock: {
    margin: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    p: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(2, 6, 9, 0.6)',
    border: '1px solid rgba(149, 185, 211, 0.2)',
    maxHeight: 420
  },
  listItem: {
    borderBottom: '1px solid rgba(190, 219, 245, 0.15)'
  },
  metricTile: {
    p: 1.5,
    borderRadius: 1,
    border: '1px solid rgba(149, 185, 211, 0.25)',
    backgroundColor: 'rgba(2, 6, 9, 0.5)',
  },
  metricLabel: {
    color: 'rgba(205, 229, 250, 0.78)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    fontWeight: 800,
  }
};

export default styles;
