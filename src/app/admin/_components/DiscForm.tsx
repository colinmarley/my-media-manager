import React, { useState } from 'react';
import useAddDisc from '../../../hooks/newMedia/useAddDisc';
import { ImageFile, VideoFile } from '../../../types/firebase/FBCommon.type';

const AddDiscForm: React.FC = () => {
  const { addDisc, loading, error } = useAddDisc();
  const [title, setTitle] = useState('');
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [isPartOfSet, setIsPartOfSet] = useState(false);
  const [isRentalDisc, setIsRentalDisc] = useState(false);
  const [containsSpecialFeatures, setContainsSpecialFeatures] = useState(false);
  const [resourceId, setResourceId] = useState<string | undefined>(undefined);
  const [releaseDate, setReleaseDate] = useState<string | undefined>(undefined);
  const [genre, setGenre] = useState<string | undefined>(undefined);
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const [subtitles, setSubtitles] = useState<string[] | undefined>(undefined);
  const [regionCode, setRegionCode] = useState<string | undefined>(undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDisc(
      title,
      videoFiles,
      imageFiles,
      isPartOfSet,
      isRentalDisc,
      containsSpecialFeatures,
      resourceId,
      releaseDate,
      genre,
      language,
      subtitles,
      regionCode
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Title:</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
      </div>
      <div>
        <label>Video Files:</label>
        <input type="file" multiple onChange={(e) => {
          const files = Array.from(e.target.files || []);
          const videoFiles = files.map(file => ({
            fileName: file.name,
            fileSize: file.size,
            duration: 0, // Placeholder, you might want to handle this differently
            resolution: '', // Placeholder, you might want to handle this differently
            format: file.type,
          }));
          setVideoFiles(videoFiles);
        }} />
      </div>
      <div>
        <label>Image Files:</label>
        <input type="file" multiple onChange={(e) => {
          const files = Array.from(e.target.files || []);
          const imageFiles = files.map(file => ({
            fileName: file.name,
            fileSize: file.size,
            resolution: '', // Placeholder, you might want to handle this differently
            format: file.type,
          }));
          setImageFiles(imageFiles);
        }} />
      </div>
      <div>
        <label>Is Part of Set:</label>
        <input type="checkbox" checked={isPartOfSet} onChange={(e) => setIsPartOfSet(e.target.checked)} />
      </div>
      <div>
        <label>Is Rental Disc:</label>
        <input type="checkbox" checked={isRentalDisc} onChange={(e) => setIsRentalDisc(e.target.checked)} />
      </div>
      <div>
        <label>Contains Special Features:</label>
        <input type="checkbox" checked={containsSpecialFeatures} onChange={(e) => setContainsSpecialFeatures(e.target.checked)} />
      </div>
      <div>
        <label>Resource ID:</label>
        <input type="text" value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="Resource ID" />
      </div>
      <div>
        <label>Release Date:</label>
        <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} placeholder="Release Date" />
      </div>
      <div>
        <label>Genre:</label>
        <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Genre" />
      </div>
      <div>
        <label>Language:</label>
        <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language" />
      </div>
      <div>
        <label>Subtitles:</label>
        <input type="text" value={subtitles?.join(', ')} onChange={(e) => setSubtitles(e.target.value.split(', '))} placeholder="Subtitles (comma separated)" />
      </div>
      <div>
        <label>Region Code:</label>
        <input type="text" value={regionCode} onChange={(e) => setRegionCode(e.target.value)} placeholder="Region Code" />
      </div>
      <button type="submit" disabled={loading}>
        {loading ? 'Adding...' : 'Add Disc'}
      </button>
      {error && <p>{error}</p>}
    </form>
  );
};

export default AddDiscForm;