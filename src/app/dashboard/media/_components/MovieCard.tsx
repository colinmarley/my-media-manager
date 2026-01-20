import { OmdbSearchResponse } from "@/types/OmdbResponse.type";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";

interface MovieCardProps {
  mediaSearchResult: OmdbSearchResponse;
  onAddToCollection: (movie: any) => void;
  onExpand: (movie: any) => void;
}

const MovieCard = ({ mediaSearchResult, onAddToCollection, onExpand }: MovieCardProps) => {
  return (
    <Card sx={Styles.card}>
      {/* Movie Poster */}
      <CardMedia
        component="img"
        height="500"
        image={mediaSearchResult.Poster}
        alt={mediaSearchResult.Title}
      />
      {/* Movie Details */}
      <CardContent>
        <Typography variant="h6" component="div" gutterBottom>
          {mediaSearchResult.Title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Year: {mediaSearchResult.Year}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Type: {mediaSearchResult.Type}
        </Typography>
        {/* Action Buttons */}
        <Grid container spacing={2} sx={Styles.actionsContainer}>
          <Grid size={6}>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={() => onAddToCollection(mediaSearchResult)}
            >
              Add to Collection
            </Button>
          </Grid>
          <Grid size={6}>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={() => onExpand(mediaSearchResult)}
            >
              Show Movie Details
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

const Styles = {
  card: { maxWidth: 345, margin: "16px", boxShadow: 3 },
  actionsContainer: { marginTop: "16px" },
}

export default MovieCard;