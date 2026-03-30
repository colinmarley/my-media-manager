import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { validateUniqueNumbers } from '../../src/utils/validation/commonValidation';

import AddDiscForm from '../../src/app/admin/_components/DiscForm';
import ReleaseForm from '../../src/app/admin/_components/ReleaseForm';
import CollectionForm from '../../src/app/admin/_components/CollectionForm';
import SeriesForm from '../../src/app/admin/_components/SeriesForm';
import SeasonForm from '../../src/app/admin/_components/SeasonForm';
import EpisodeForm from '../../src/app/admin/_components/EpisodeForm';
import MovieForm from '../../src/app/admin/_components/MovieForm';

const addDocumentMock = vi.fn().mockResolvedValue(undefined);
const getDocumentsByFieldMock = vi.fn().mockResolvedValue([]);
const addDiscMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/service/firebase/FirestoreService', () => ({
  default: vi.fn().mockImplementation(() => ({
    addDocument: addDocumentMock,
    getDocumentsByField: getDocumentsByFieldMock,
  })),
}));

vi.mock('../../src/hooks/newMedia/useAddDisc', () => ({
  default: () => ({
    addDisc: addDiscMock,
    loading: false,
    error: null,
  }),
}));

vi.mock('../../src/service/omdb/OmdbService', () => ({
  searchByText: vi.fn().mockResolvedValue([]),
  retrieveMediaDataById: vi.fn().mockResolvedValue({
    Title: 'Mock Title',
    Released: '01 Jan 2020',
    Runtime: '120 min',
    Country: 'US',
    Director: 'A Director',
    Actors: 'Actor A',
    Writer: 'Writer A',
    Genre: 'Action',
    Language: 'English',
    Poster: 'https://example.com/poster.jpg',
    Website: '',
    imdbID: 'tt1234567',
    Ratings: [],
    Plot: 'Mock plot',
    Rated: 'PG-13',
  }),
  retrieveMovieDataByTitle: vi.fn(),
  retrieveShowDataByTitle: vi.fn(),
}));

vi.mock('../../src/app/admin/imageManager/_components/ImageSearch', () => ({
  default: () => <div data-testid="image-search" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/common/CastDataGrid', () => ({
  default: () => <div data-testid="cast-grid" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/common/DirectorDataGrid', () => ({
  default: () => <div data-testid="director-grid" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/WritersInput', () => ({
  default: () => <div data-testid="writers-input" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/RatingsInput', () => ({
  default: () => <div data-testid="ratings-input" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/movie/MovieTitleSearch', () => ({
  default: () => <div data-testid="movie-title-search" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/movie/MovieDetailsInput', () => ({
  default: () => <div data-testid="movie-details-input" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/movie/MovieLinkInput', () => ({
  default: () => <div data-testid="movie-link-input" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/modals/AddDirectorModule', () => ({
  default: () => <div data-testid="add-director-modal" />,
}));

vi.mock('../../src/app/admin/_components/formInputs/modals/AddActorModule', () => ({
  default: () => <div data-testid="add-actor-modal" />,
}));

vi.mock('../../src/store/useFormStore', () => ({
  default: () => ({
    shouldShowAddActorModal: false,
    shouldShowAddDirectorModal: false,
    openAddActorModal: vi.fn(),
    closeAddActorModal: vi.fn(),
    openAddDirectorModal: vi.fn(),
    closeAddDirectorModal: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/newMedia/useAddMovie', () => ({
  default: () => ({
    title: { value: 'Mock Movie', errors: [] },
    setTitleValue: vi.fn(),
    countries: { value: ['US'], errors: [] },
    setCountriesValue: vi.fn(),
    directors: { value: [], errors: [] },
    setDirectorsValue: vi.fn(),
    addDirector: vi.fn(),
    genres: { value: ['Action'], errors: [] },
    setGenresValue: vi.fn(),
    imageFiles: { value: [], errors: [] },
    setImageFilesValue: vi.fn(),
    languages: { value: ['English'], errors: [] },
    setLanguagesValue: vi.fn(),
    letterboxdLink: { value: '', errors: [] },
    setLetterboxdLinkValue: vi.fn(),
    plexLink: { value: '', errors: [] },
    setPlexLinkValue: vi.fn(),
    releaseDate: { value: '01-Jan-2020', errors: [] },
    setReleaseDateValue: vi.fn(),
    releases: { value: [], errors: [] },
    setReleasesValue: vi.fn(),
    runtime: { value: '2:00:00', errors: [] },
    setRuntimeValue: vi.fn(),
    cast: { value: [], errors: [] },
    setCastValue: vi.fn(),
    writers: { value: ['Writer'], errors: [] },
    setWritersValue: vi.fn(),
    omdbData: {
      value: {
        Title: 'Mock Movie',
        Released: '01 Jan 2020',
        Runtime: '120 min',
        Country: 'US',
        Director: 'Director A',
        Actors: 'Actor A',
        Writer: 'Writer A',
        Genre: 'Action',
        Language: 'English',
        Poster: 'https://example.com/poster.jpg',
        Website: '',
        imdbID: 'tt1234567',
        Ratings: [],
        Plot: 'Plot',
        Rated: 'PG-13',
      },
      errors: [],
    },
    setOmdbDataValue: vi.fn(),
    omdbResults: { value: [], errors: [] },
    setOmdbResultsValue: vi.fn(),
    ratings: { value: [], errors: [] },
    setRatingsValue: vi.fn(),
    imdbId: { value: 'tt1234567', errors: [] },
    setImdbIdValue: vi.fn(),
    certification: { value: 'PG-13', errors: [] },
    setCertificationValue: vi.fn(),
    plot: { value: 'Plot', errors: [] },
    setPlotValue: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

describe('Admin forms baseline tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Movie form shell', () => {
    render(<MovieForm />);
    expect(screen.getByText('Add Movie')).toBeInTheDocument();
  });

  it('renders Series form shell', () => {
    render(<SeriesForm />);
    expect(screen.getByText('Add New Series')).toBeInTheDocument();
  });

  it('renders Season form shell', () => {
    render(<SeasonForm />);
    expect(screen.getByText('Add New Season')).toBeInTheDocument();
  });

  it('renders Episode form shell', () => {
    render(<EpisodeForm />);
    expect(screen.getByText('Add New Episode')).toBeInTheDocument();
  });

  it('prevents Disc submit with empty required fields', async () => {
    render(<AddDiscForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Disc' }));
    expect(addDiscMock).not.toHaveBeenCalled();
  });

  it('prevents Release submit with empty required fields', async () => {
    render(<ReleaseForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Release' }));
    expect(addDocumentMock).not.toHaveBeenCalled();
  });

  it('prevents Collection submit with empty required fields', async () => {
    render(<CollectionForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Collection' }));
    expect(addDocumentMock).not.toHaveBeenCalled();
  });
});

describe('Phase B - Movie form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<MovieForm />);
    expect(screen.getByText('Search and Import')).toBeInTheDocument();
    expect(screen.getByText('Core Details')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('Links and Media')).toBeInTheDocument();
  });
});

describe('Phase B - Disc form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<AddDiscForm />);
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Physical and Flags')).toBeInTheDocument();
    expect(screen.getByText('Video Files')).toBeInTheDocument();
    expect(screen.getByText('Image Files')).toBeInTheDocument();
    expect(screen.getByText('Optional Metadata')).toBeInTheDocument();
  });
});

describe('Phase C - Series form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<SeriesForm />);
    expect(screen.getByText('Search and Import')).toBeInTheDocument();
    expect(screen.getByText('Core Details')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('Seasons and Episodes')).toBeInTheDocument();
    expect(screen.getByText('Links and Media')).toBeInTheDocument();
  });

  it('renders NestedSeasonEditor with add-season button', () => {
    render(<SeriesForm />);
    expect(screen.getByTestId('add-season-btn')).toBeInTheDocument();
  });

  it('adds a season row when Add Season is clicked', () => {
    render(<SeriesForm />);
    expect(screen.queryByLabelText(/Season #/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-season-btn'));
    expect(screen.getByLabelText(/Season #/i)).toBeInTheDocument();
  });
});

describe('Phase C - Season form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<SeasonForm />);
    expect(screen.getByText('Parent Selection')).toBeInTheDocument();
    expect(screen.getByText('Core Details')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('Episodes')).toBeInTheDocument();
    expect(screen.getByText('Links and Media')).toBeInTheDocument();
  });

  it('renders NestedEpisodeEditor with add-episode button', () => {
    render(<SeasonForm />);
    expect(screen.getByTestId('add-episode-btn')).toBeInTheDocument();
  });

  it('adds an episode row when Add Episode is clicked', () => {
    render(<SeasonForm />);
    expect(screen.queryByLabelText(/Ep #/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-episode-btn'));
    expect(screen.getByLabelText(/Ep #/i)).toBeInTheDocument();
  });
});

describe('Phase C - Episode form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<EpisodeForm />);
    expect(screen.getByText('Parent Selection')).toBeInTheDocument();
    expect(screen.getByText('Core Details')).toBeInTheDocument();
    expect(screen.getByText('Credits')).toBeInTheDocument();
    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('Links and Media')).toBeInTheDocument();
  });
});

describe('Phase C - validateUniqueNumbers utility', () => {
  it('returns empty array when all numbers are unique', () => {
    const items = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(validateUniqueNumbers(items, 'season')).toEqual([]);
  });

  it('returns error message listing duplicate numbers', () => {
    const items = [{ number: 1 }, { number: 2 }, { number: 1 }];
    const result = validateUniqueNumbers(items, 'season');
    expect(result.length).toBe(1);
    expect(result[0]).toContain('1');
  });

  it('returns empty array for empty list', () => {
    expect(validateUniqueNumbers([], 'episode')).toEqual([]);
  });

  it('detects multiple duplicate numbers', () => {
    const items = [{ number: 1 }, { number: 1 }, { number: 2 }, { number: 2 }];
    const result = validateUniqueNumbers(items, 'episode');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('episode');
  });
});

describe('Phase D - Release form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<ReleaseForm />);
    expect(screen.getByText('Identity and Type')).toBeInTheDocument();
    expect(screen.getByText('Disc Associations')).toBeInTheDocument();
    expect(screen.getByText('Media Associations')).toBeInTheDocument();
    expect(screen.getByText('Extras')).toBeInTheDocument();
    expect(screen.getByText('Media Assets')).toBeInTheDocument();
  });

  it('renders NestedExtrasEditor with add-extra button', () => {
    render(<ReleaseForm />);
    expect(screen.getByTestId('add-extra-btn')).toBeInTheDocument();
  });

  it('adds an extra row when Add Extra is clicked', () => {
    render(<ReleaseForm />);
    expect(screen.queryByLabelText(/^Type$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-extra-btn'));
    expect(screen.getByLabelText(/^Type$/i)).toBeInTheDocument();
  });

  it('renders Disc Associations repeater buttons', () => {
    render(<ReleaseForm />);
    expect(screen.getByTestId('add-disc-id-btn')).toBeInTheDocument();
    expect(screen.getByTestId('add-disc-type-btn')).toBeInTheDocument();
  });
});

describe('Phase D - Collection form sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all expected sections', () => {
    render(<CollectionForm />);
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Classification and Credits')).toBeInTheDocument();
    expect(screen.getByText('Included Entries')).toBeInTheDocument();
    expect(screen.getByText('Media Assets')).toBeInTheDocument();
  });

  it('renders Add Director button', () => {
    render(<CollectionForm />);
    expect(screen.getByTestId('add-director-btn')).toBeInTheDocument();
  });

  it('adds a director row when Add Director is clicked', () => {
    render(<CollectionForm />);
    expect(screen.queryByLabelText(/Director 1/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-director-btn'));
    expect(screen.getByLabelText(/Director 1/i)).toBeInTheDocument();
  });
});
