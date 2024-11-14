import { useState } from 'react';
import { searchByText } from '../../../../service/OmdbService';

const SearchBar = ({ setSearchResults }: { setSearchResults: (results: any[]) => void }) => {
  const [query, setQuery] = useState('');

  const handleSearch = async () => {
    try {
      const results = await searchByText(query);
      console.log(results);
      setSearchResults(results);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for movies or shows..."
      />
      <button onClick={handleSearch}>Search</button>
    </div>
  );
};

export default SearchBar;