import { AuditFields, Award, ExternalIds } from './FBCommon.type';

export interface Director extends AuditFields {
    id: string; // unique string, length = 20 alphanumeric characters
    fullName: string; // Director's full name
    movieIds: string[]; // List of movie IDs the director is associated with
    seriesIds: string[]; // List of series IDs the director is associated with
    seasonIds?: string[];
    episodeIds?: string[];
    birthplace: string; // Director's birthplace
    birthday: string; // Director's birthday
    deathDate?: string | null;
    nationality?: string;
    biography?: string;
    notes?: string;
    externalIds?: ExternalIds;
    awards?: Award[];
}