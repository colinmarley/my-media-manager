import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import MovieCard from './MovieCard';

const MovieList = ({ movies, onAddToCollection }: { movies: OmdbSearchResponse[], onAddToCollection: (movie: any) => void }) => {
    console.log("Movies: ", movies);
  return (
    <div style={{ overflowY: 'scroll', height: '80vh' }}>
      {movies.map((movie) => (
        <MovieCard key={movie.imdbID} movie={movie} onAddToCollection={onAddToCollection} />
      ))}
    </div>
  );
};

export default MovieList;