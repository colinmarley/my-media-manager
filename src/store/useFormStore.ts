import { create } from 'zustand';
import CatalogService from '../service/catalog/CatalogService';

interface FormStoreState {
    shouldShowAddActorModal: boolean;
    shouldShowAddDirectorModal: boolean;
    shouldShowAddWriterModal: boolean;
    actorOptions: { label: string; id: string }[];
    directorOptions: { label: string; id: string }[];
    writerOptions: { label: string; id: string }[];
    refreshActorOptions: () => Promise<void>;
    refreshDirectorOptions: () => Promise<void>;
    refreshWriterOptions: () => Promise<void>;
    openAddActorModal: () => void;
    closeAddActorModal: () => void;
    openAddDirectorModal: () => void;
    closeAddDirectorModal: () => void;
    openAddWriterModal: () => void;
    closeAddWriterModal: () => void;
}

const useFormStore = create<FormStoreState>((set) => {
    const actorService = new CatalogService('actors');
    const directorService = new CatalogService('directors');
    const writerService = new CatalogService('writers');

    const refreshActorOptions = async () => {
        try {
            const actors = await actorService.getDocuments();
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

    const refreshDirectorOptions = async () => {
        try {
            const directors = await directorService.getDocuments();
            set({
                directorOptions: [
                    ...directors.map((director) => ({ label: director.fullName, id: director.id })),
                    { label: '+ New Director to Collection', id: 'new' },
                ],
            });
        } catch (error) {
            console.warn('Unable to load director options (non-critical):', error);
            set({
                directorOptions: [{ label: '+ New Director to Collection', id: 'new' }],
            });
        }
    };

    const refreshWriterOptions = async () => {
        try {
            const writers = await writerService.getDocuments();
            set({
                writerOptions: [
                    ...writers.map((writer) => ({ label: writer.fullName, id: writer.id })),
                    { label: '+ New Writer to Collection', id: 'new' },
                ],
            });
        } catch (error) {
            console.warn('Unable to load writer options (non-critical):', error);
            set({
                writerOptions: [{ label: '+ New Writer to Collection', id: 'new' }],
            });
        }
    };

    const closeAddActorModal = () => {
        set({ shouldShowAddActorModal: false });
        void refreshActorOptions();
    };

    const closeAddDirectorModal = () => {
        set({ shouldShowAddDirectorModal: false });
        void refreshDirectorOptions();
    };

    const closeAddWriterModal = () => {
        set({ shouldShowAddWriterModal: false });
        void refreshWriterOptions();
    };

    return {
        shouldShowAddActorModal: false,
        shouldShowAddDirectorModal: false,
        shouldShowAddWriterModal: false,
        actorOptions: [],
        directorOptions: [],
        writerOptions: [],
        refreshActorOptions,
        refreshDirectorOptions,
        refreshWriterOptions,
        openAddActorModal: () => set({ shouldShowAddActorModal: true }),
        closeAddActorModal,
        openAddDirectorModal: () => set({ shouldShowAddDirectorModal: true }),
        closeAddDirectorModal,
        openAddWriterModal: () => set({ shouldShowAddWriterModal: true }),
        closeAddWriterModal,
    };
});

export default useFormStore;