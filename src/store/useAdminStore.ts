import { create } from 'zustand';

interface AdminState {
  selectedType: string;
  setSelectedType: (type: string) => void;
}

const useAdminStore = create<AdminState>((set) => ({
  selectedType: 'Movie',
  setSelectedType: (type: string) => {
    console.log(type);
    set({ selectedType: type });
  },
}));

export default useAdminStore;