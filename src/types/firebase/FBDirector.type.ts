export interface Director {
    id: string; // unique string, length = 20 alphanumeric characters
    fullName: string; // Director's full name
    movieIds: string[]; // List of movie IDs the director is associated with
    seriesIds: string[]; // List of series IDs the director is associated with
    birthplace: string; // Director's birthplace
    birthday: string; // Director's birthday
    notes: string; // Additional notes about the director
}