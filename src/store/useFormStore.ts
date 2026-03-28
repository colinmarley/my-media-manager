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
        try {
            const actors = await firestoreService.getDocuments();
            set({
                actorOptions: [
                    ...actors.map((actor) => ({ label: actor.fullName, id: actor.id })),
                    { label: '+ New Actor to Collection', id: 'new' },
                ],
            });
        } catch (error) {
            console.warn('Unable to load actor options (non-critical):', error);
            set({
                actorOptions: [{ label: '+ New Actor to Collection', id: 'new' }],
            });
        }
    };

    const closeAddActorModal = () => {
        set({ shouldShowAddActorModal: false });
        void refreshActorOptions();
    };

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