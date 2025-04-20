import React from 'react';
import { OmdbResponseFull } from '../../../../../types/OmdbResponse.type';
import '../_styles/MediaInformation.module.css';
import Container from '@mui/material/Container';

interface MediaInformationProps {
  data: OmdbResponseFull  | null;
}

const MediaInformation: React.FC<MediaInformationProps> = ({ data }) => {
  const placeholderImage = 'https://picsum.photos/200/300';
  console.log("Media Information");
  console.log(data);

  return (
    <Container className="media-information">
      <Container className="media-header">
        <Container className="media-poster">
          <img
            src={data?.Poster || placeholderImage}
            alt={`${data?.Title} Poster`}
            onError={(e) => (e.currentTarget.src = placeholderImage)}
          />
        </Container>
        <Container className="media-title">
          <h1>{data?.Title}</h1>
          <p><strong>Year:</strong> {data?.Year}</p>
          <p><strong>Rated:</strong> {data?.Rated}</p>
          <p><strong>Released:</strong> {data?.Released}</p>
          <p><strong>Runtime:</strong> {data?.Runtime}</p>
          <p><strong>Genre:</strong> {data?.Genre}</p>
        </Container>
      </Container>
      <Container className="media-details">
        <Section title="Director and Writers">
          <p><strong>Director:</strong> {data?.Director}</p>
          <p><strong>Writer:</strong> {data?.Writer}</p>
        </Section>
        <Section title="Cast">
          <p><strong>Actors:</strong> {data?.Actors}</p>
        </Section>
        <Section title="Plot">
          <p><strong>Plot:</strong> {data?.Plot}</p>
        </Section>
        <Section title="Additional Information">
          <p><strong>Language:</strong> {data?.Language}</p>
          <p><strong>Country:</strong> {data?.Country}</p>
          <p><strong>Awards:</strong> {data?.Awards}</p>
          <p><strong>Metascore:</strong> {data?.Metascore}</p>
          <p><strong>IMDB Rating:</strong> {data?.imdbRating}</p>
          <p><strong>IMDB Votes:</strong> {data?.imdbVotes}</p>
          <p><strong>IMDB ID:</strong> {data?.imdbID}</p>
          <p><strong>Type:</strong> {data?.Type}</p>
          {data?.Dvd && <p><strong>DVD Release:</strong> {data?.Dvd}</p>}
          {data?.BoxOffice && <p><strong>Box Office:</strong> {data?.BoxOffice}</p>}
          {data?.Production && <p><strong>Production:</strong> {data?.Production}</p>}
          {data?.Website && <p><strong>Website:</strong> <a href={data?.Website} target="_blank" rel="noopener noreferrer">{data?.Website}</a></p>}
          {data?.TotalSeasons && <p><strong>Total Seasons:</strong> {data?.TotalSeasons}</p>}
          <p><strong>Response:</strong> {data?.Response}</p>
        </Section>
      </Container>
    </Container>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="section">
    <h2>{title}</h2>
    {children}
  </div>
);

export default MediaInformation;