import { searchByText } from '../../../../service/OmdbService';
import { useMediaSelectorContext } from '@/context/MediaSelectorContext';

const SearchBar = () => {
  const { setSearchResults, searchQuery, setSearchQuery } = useMediaSelectorContext();

  const handleSearch = async () => {
    try {
      const results = await searchByText(searchQuery);
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
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search for movies or shows..."
      />
      <button onClick={handleSearch}>Search</button>
    </div>
  );
};

export default SearchBar;