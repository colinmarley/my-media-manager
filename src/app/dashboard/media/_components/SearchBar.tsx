import { searchByText } from '@/service/omdb/OmdbService';
import { useMediaSelectorContext } from '@/context/MediaSelectorContext';
import Container from '@mui/material/Container';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';

const SearchBar = () => {
  const { setSearchResults, searchQuery, setSearchQuery } = useMediaSelectorContext();

  const handleSearch = async () => {
    try {
      const results = await searchByText(searchQuery);
      console.log(results);
      setSearchResults(results);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault(); // Prevent the default form submission behavior
      handleSearch();
    }
  };

  return (
    <Container
      sx={Styles.searchBarContainer}
    >
      <Grid container spacing={2} alignItems="center">
        <Grid size={9}>
          <TextField
            fullWidth
            variant="outlined"
            label="Search for movies or shows"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown} // Add the onKeyDown handler
          />
        </Grid>
        <Grid size={3}>
          <Button
            fullWidth
            variant="contained"
            color="primary"
            onClick={handleSearch}
          >
            Search
          </Button>
        </Grid>
      </Grid>
    </Container>
  );
};

const Styles = {
  searchBarContainer: {
    display: 'flex-start',
    justifyContent: 'left',
    alignItems: 'center',
    paddingX: '0px',
    paddingY: '20px',
    borderRadius: '8px',
    margin: '0',
  },
}

export default SearchBar;