import { create } from 'zustand';
import ImageService from '../service/ImageService';

interface ImageState {
  listResults: { name: string; url: string }[];
  currentName: string;
  newName: string;
  subfolder: string;
  message: string;
  previewUrl: string | null;
  previewName: string;
  renameMessage: string;
  setListResults: (results: { name: string; url: string }[]) => void;
  setCurrentName: (name: string) => void;
  setNewName: (name: string) => void;
  setSubfolder: (subfolder: string) => void;
  setMessage: (message: string) => void;
  setPreviewUrl: (url: string | null) => void;
  setPreviewName: (name: string) => void;
  setRenameMessage: (message: string) => void;
  handleList: () => Promise<void>;
  handleRename: () => Promise<void>;
  handleRenamePreview: () => Promise<void>;
}

const imageService = new ImageService();

const useImageStore = create<ImageState>((set) => ({
  listResults: [],
  currentName: '',
  newName: '',
  subfolder: '',
  message: '',
  previewUrl: null,
  previewName: '',
  renameMessage: '',
  setListResults: (results) => set({ listResults: results }),
  setCurrentName: (name) => set({ currentName: name }),
  setNewName: (name) => set({ newName: name }),
  setSubfolder: (subfolder) => set({ subfolder }),
  setMessage: (message) => set({ message }),
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setPreviewName: (name) => set({ previewName: name }),
  setRenameMessage: (message) => set({ renameMessage: message }),
  handleList: async () => {
    try {
      const results = await imageService.listImages();
      set({ listResults: results });
    } catch (error) {
      console.error('Error listing images:', error);
    }
  },
  handleRename: async () => {
    const { currentName, newName, subfolder, setMessage, setCurrentName, setNewName, setSubfolder } = useImageStore.getState();
    const newFullName = newName.replaceAll(" ", "_").toUpperCase() + "_DVD_SLEEVE.png";
    try {
      const resultMessage = await imageService.renameImage(currentName, newFullName, subfolder);
      setMessage(resultMessage);
      setCurrentName('');
      setNewName('');
      setSubfolder('');
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  },
  handleRenamePreview: async () => {
    const { previewName, newName, subfolder, setRenameMessage, setMessage, setCurrentName, setNewName, setPreviewName, setSubfolder } = useImageStore.getState();
    const newFullName = newName.replaceAll(" ", "_").toUpperCase() + "_DVD_SLEEVE.png";
    try {
      const resultMessage = await imageService.renameImage(previewName, newFullName, subfolder);
      setRenameMessage(resultMessage);
      setMessage(resultMessage);
      setCurrentName('');
      setNewName('');
      setPreviewName('');
      setSubfolder('');
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  },
}));

export default useImageStore;