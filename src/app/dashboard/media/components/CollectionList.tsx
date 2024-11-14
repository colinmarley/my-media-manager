import { OmdbSearchResponse } from "@/types/OmdbResponse.type";
import MovieTile from "./MovieTile";

const CollectionList = ({ collection }: { collection: OmdbSearchResponse[] }) => {
  return (
    <div style={{ overflowY: 'scroll', height: '80vh' }}>
      {collection.map((movie) => (<MovieTile movieInfo={movie} />))}
    </div>
  );
};

export default CollectionList;