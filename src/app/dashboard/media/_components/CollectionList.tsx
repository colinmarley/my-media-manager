import { OmdbSearchResponse } from "@/types/OmdbResponse.type";
import MovieTile from "./MovieTile";
import Container from "@mui/material/Container";

const CollectionList = ({ collection }: { collection: OmdbSearchResponse[] }) => {
  return (
    <Container sx={Styles.collectionListContainer}>
      {collection.map((movie: OmdbSearchResponse) => (<MovieTile movieInfo={movie} />))}
    </Container>
  );
};

const Styles = {
  collectionListContainer: {
    overflowY: 'scroll',
  },
}

export default CollectionList;