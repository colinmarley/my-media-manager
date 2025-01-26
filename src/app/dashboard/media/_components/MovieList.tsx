import { OmdbSearchResponse } from '@/types/OmdbResponse.type';
import MovieCard from './MovieCard';
import { useMediaSelectorContext } from '@/context/MediaSelectorContext';

interface MovieListProps {
  onAddToCollection: (movie: any) => void;
  onExpand: (movie: any) => void;
}


const MovieList = ({ onAddToCollection, onExpand }: MovieListProps) => {
  const { searchResults } = useMediaSelectorContext();
  console.log("Movie List");
  console.log(searchResults);
  return (
    <div style={{ overflowY: 'scroll', height: '80vh' }}>
      {searchResults.map((searchResult: OmdbSearchResponse) => (
        <MovieCard key={searchResult.imdbID} mediaSearchResult={searchResult} onAddToCollection={onAddToCollection} onExpand={onExpand} />
      ))}
    </div>
  );
};

export default MovieList;