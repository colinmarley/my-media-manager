const MovieCard = ({ movie, onAddToCollection }: { movie: any, onAddToCollection: (movie: any) => void }) => {
  return (
    <div>
      <img src={movie.Poster} alt={movie.Title} />
      <h3>{movie.Title}</h3>
      <button onClick={() => onAddToCollection(movie)}>Add to Collection</button>
    </div>
  );
};

export default MovieCard;