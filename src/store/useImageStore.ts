import { create } from 'zustand';
import ImageService from '../service/ImageService';

export interface ImageResult {
    name: string;
    url: string;
    parentFolder: string;
    size: string;
    lastModified: string;
}

interface ImageState {
  listResults: { name: string; url: string }[];
  imageResults: ImageResult[];
  currentName: string;
  newName: string;
  subfolder: string;
  message: string;
  previewUrl: string | null;
  previewName: string;
  renameMessage: string;
  setListResults: (results: { name: string; url: string }[]) => void;
  setImageResults: (results: ImageResult[]) => void;
  setCurrentName: (name: string) => void;
  setNewName: (name: string) => void;
  setSubfolder: (subfolder: string) => void;
  setMessage: (message: string) => void;
  setPreviewUrl: (url: string | null) => void;
  setPreviewName: (name: string) => void;
  setRenameMessage: (message: string) => void;
  handleList: () => Promise<void>;
  handleRename: (currentName: string, newName: string, subfolder: string) => Promise<void>;
  handleRenamePreview: (name: string, subfolder: string) => Promise<void>;
}

const imageService = new ImageService();

const useImageStore = create<ImageState>((set) => ({
  listResults: [],
  imageResults: [],
  currentName: '',
  newName: '',
  subfolder: '',
  message: '',
  previewUrl: null,
  previewName: '',
  renameMessage: '',
  setListResults: (results) => set({ listResults: results }),
  setImageResults: (results) => set({ imageResults: results }),
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
      set({ imageResults: results });
    } catch (error) {
      console.error('Error listing images:', error);
    }
  },
  handleRename: async (currentName: string, newName: string, subfolder: string) => {
    const { setMessage } = useImageStore.getState();
    const newFullName = newName.replaceAll(" ", "_").toUpperCase() + "_DVD_SLEEVE.png";
    try {
      const resultMessage = await imageService.renameImage(currentName, newFullName, subfolder);
      setMessage(resultMessage);
    } catch (error) {
      console.error('Error renaming image:', error);
    }
  },
  handleRenamePreview: async (newName: string, subfolder: string) => {
    const { previewName, setRenameMessage, setMessage, setCurrentName, setNewName, setPreviewName, setSubfolder } = useImageStore.getState();
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