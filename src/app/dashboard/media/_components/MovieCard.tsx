import { OmdbSearchResponse } from "@/types/OmdbResponse.type";

interface MovieCardProps {
  mediaSearchResult: OmdbSearchResponse;
  onAddToCollection: (movie: any) => void;
  onExpand: (movie: any) => void;
}

const MovieCard = ({ mediaSearchResult, onAddToCollection, onExpand }: MovieCardProps) => {
  return (
    <div>
      <img src={mediaSearchResult.Poster} alt={mediaSearchResult.Title} />
      <h3>{mediaSearchResult.Title}</h3>
      <button onClick={() => onAddToCollection(mediaSearchResult)}>Add to Collection</button>
      <button onClick={() => onExpand(mediaSearchResult)}>Expand</button>
    </div>
  );
};

export default MovieCard;