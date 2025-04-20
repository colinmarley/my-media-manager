import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import MovieCard from './MovieCard';
import { useMediaSelectorContext } from '@/context/MediaSelectorContext';
import Container from '@mui/material/Container';
import { Divider } from '@mui/material';

interface MovieListProps {
  onAddToCollection: (movie: any) => void;
  onExpand: (movie: any) => void;
}

const MovieList = ({ onAddToCollection, onExpand }: MovieListProps) => {
  const { searchResults } = useMediaSelectorContext();
  return (
    <Container sx={Styles.movieListContainer}>
      {searchResults.map((searchResult: OmdbSearchResponse, index: number) => {
        return (
          <>
            {(index > 0) && <Divider sx={Styles.divider}/>}
            <MovieCard
              key={searchResult.imdbID}
              mediaSearchResult={searchResult}
              onAddToCollection={onAddToCollection}
              onExpand={onExpand} />
          </>
        );
      })}
    </Container>
  );
};

const Styles = {
  movieListContainer: {
    overflowY: 'scroll',
  },
  divider: {
    marginY: '30px',
  },
}

export default MovieList;