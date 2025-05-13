import { create } from 'zustand';
import FirestoreService from '../service/firebase/FirestoreService';

interface FormStoreState {
    shouldShowAddActorModal: boolean;
    shouldShowAddDirectorModal: boolean;
    actorOptions: { label: string; id: string }[];
    refreshActorOptions: () => Promise<void>;
    openAddActorModal: () => void;
    closeAddActorModal: () => void;
    openAddDirectorModal: () => void;
    closeAddDirectorModal: () => void;
}

const useFormStore = create<FormStoreState>((set) => {
    const firestoreService = new FirestoreService('actors');

    const refreshActorOptions = async () => {
        const actors = await firestoreService.getDocuments();
        set({
            actorOptions: [
                ...actors.map((actor) => ({ label: actor.fullName, id: actor.id })),
                { label: '+ New Actor to Collection', id: 'new' },
            ],
        });
    };

    const closeAddActorModal = () => {
        set({ shouldShowAddActorModal: false });
        refreshActorOptions();
    };

    // Initialize actorOptions on store creation
    refreshActorOptions();

    return {
        shouldShowAddActorModal: false,
        shouldShowAddDirectorModal: false,
        actorOptions: [],
        refreshActorOptions,
        openAddActorModal: () => set({ shouldShowAddActorModal: true }),
        closeAddActorModal: () => set({ shouldShowAddActorModal: false }),
        openAddDirectorModal: () => set({ shouldShowAddDirectorModal: true }),
        closeAddDirectorModal: () => set({ shouldShowAddDirectorModal: false }),
    };
});

export default useFormStore;