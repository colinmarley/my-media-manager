"use client";

import React, { useState } from 'react';
import AddDiscForm from './_components/DiscForm';

const AdminPage: React.FC = () => {
  const [selectedType, setSelectedType] = useState<string>('');

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedType(e.target.value);
  };

  return (
    <div>
      <label htmlFor="type-select">Add a new </label>
      <select id="type-select" value={selectedType} onChange={handleSelectChange}>
        <option value="">Select a type</option>
        <option value="Resource">Resource</option>
        <option value="Disc">Disc</option>
        <option value="Movie">Movie</option>
        <option value="Collection">Collection</option>
        <option value="Series">Series</option>
        <option value="Season">Season</option>
        <option value="Episode">Episode</option>
      </select>

      {selectedType && <CustomComponent type={selectedType} />}
    </div>
  );
};

interface CustomComponentProps {
  type: string;
}

const CustomComponent: React.FC<CustomComponentProps> = ({ type }) => {
  switch (type) {
    case 'Resource':
      return <ResourceForm />;
    case 'Disc':
      return <AddDiscForm />;
    case 'Movie':
      return <MovieForm />;
    case 'Collection':
      return <CollectionForm />;
    case 'Series':
      return <SeriesForm />;
    case 'Season':
      return <SeasonForm />;
    case 'Episode':
      return <EpisodeForm />;
    default:
      return null;
  }
};

const ResourceForm: React.FC = () => (
  <div>
    <h2>Add a new Resource</h2>
    <input type="text" placeholder="Resource Name" />
    <input type="text" placeholder="Resource Description" />
    {/* Add more input fields as needed */}
  </div>
);

const MovieForm: React.FC = () => (
  <div>
    <h2>Add a new Movie</h2>
    <input type="text" placeholder="Movie Title" />
    <input type="text" placeholder="Director" />
    <input type="text" placeholder="Release Year" />
    {/* Add more input fields as needed */}
  </div>
);

const CollectionForm: React.FC = () => (
  <div>
    <h2>Add a new Collection</h2>
    <input type="text" placeholder="Collection Name" />
    <input type="text" placeholder="Collection Description" />
    {/* Add more input fields as needed */}
  </div>
);

const SeriesForm: React.FC = () => (
  <div>
    <h2>Add a new Series</h2>
    <input type="text" placeholder="Series Title" />
    <input type="text" placeholder="Creator" />
    <input type="text" placeholder="Number of Seasons" />
    {/* Add more input fields as needed */}
  </div>
);

const SeasonForm: React.FC = () => (
  <div>
    <h2>Add a new Season</h2>
    <input type="text" placeholder="Season Number" />
    <input type="text" placeholder="Series Title" />
    <input type="text" placeholder="Number of Episodes" />
    {/* Add more input fields as needed */}
  </div>
);

const EpisodeForm: React.FC = () => (
  <div>
    <h2>Add a new Episode</h2>
    <input type="text" placeholder="Episode Title" />
    <input type="text" placeholder="Season Number" />
    <input type="text" placeholder="Episode Number" />
    {/* Add more input fields as needed */}
  </div>
);

export default AdminPage;