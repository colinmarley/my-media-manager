import React, { useState } from 'react';
import ImageService from '../../../../service/ImageService';
import ImageSearch from './ImageSearch';

const ImageManager: React.FC = () => {
  const [listResults, setListResults] = useState<string>('');
  const [currentName, setCurrentName] = useState('');
  const [newName, setNewName] = useState('');
  const [subfolder, setSubfolder] = useState('');
  const [message, setMessage] = useState('');

  const imageService = new ImageService();

  const handleList = async () => {
    try {
      const results = await imageService.listImages();
      setListResults(results);
    } catch (error) {
      console.error('Error listing images:', error);
    }
  };

  const handleRename = async () => {
    try {
      const resultMessage = await imageService.renameImage(currentName, newName, subfolder);
      setMessage(resultMessage);
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  };

  return (
    <div>
      <ImageSearch />
      <div>
        <h2>List Images</h2>
        <button onClick={handleList}>List Images</button>
        <div dangerouslySetInnerHTML={{ __html: listResults }} />
      </div>
      <div>
        <h2>Rename Image</h2>
        <input type="text" value={currentName} onChange={(e) => setCurrentName(e.target.value)} placeholder="Current Name" />
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Name" />
        <input type="text" value={subfolder} onChange={(e) => setSubfolder(e.target.value)} placeholder="Subfolder (optional)" />
        <button onClick={handleRename}>Rename</button>
        {message && <p>{message}</p>}
      </div>
    </div>
  );
};

export default ImageManager;