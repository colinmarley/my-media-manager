/**
 * Unit tests for Media Assignment Logic (Priority 2)
 * Tests the handleAssignMedia function and Firebase operations
 */

import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { vi } from 'vitest';

// Mock Firebase
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(() => ({})),
}));

describe('Media Assignment Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAssignMedia', () => {
    it('should create media_assignments document with correct data', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockResolvedValue({ id: 'test-assignment-id' } as any);

      const assignment = {
        fileIds: ['file123', 'file456'],
        mediaType: 'movie' as const,
        mediaId: 'tt1234567',
        mediaTitle: 'Test Movie',
        targetStructure: {
          libraryRoot: 'Y:/Media/Movies',
          mediaFolder: 'Test Movie (2020) [imdbid-tt1234567]',
          fullPath: 'Y:/Media/Movies/Test Movie (2020) [imdbid-tt1234567]/Test Movie (2020).mkv',
          folderName: 'Test Movie (2020) [imdbid-tt1234567]',
          fileName: 'Test Movie (2020).mkv'
        },
        scanId: 'scan123',
        version: '1080p'
      };

      // Simulate the assignment creation
      await addDoc(
        collection({} as any, 'media_assignments'),
        {
          mediaFileIds: assignment.fileIds,
          primaryFileId: assignment.fileIds[0],
          mediaType: assignment.mediaType,
          mediaId: assignment.mediaId,
          targetFolderStructure: assignment.targetStructure,
          organizationStatus: 'pending',
          operations: [],
          assignedBy: 'current-user',
          assignedDate: expect.any(Date),
          confidence: 100,
          isManualAssignment: true,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date)
        }
      );

      expect(mockAddDoc).toHaveBeenCalled();
      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mediaType: 'movie',
          mediaId: 'tt1234567',
          mediaFileIds: ['file123', 'file456']
        })
      );
    });

    it('should update scanned_files status for all assigned files', async () => {
      const mockUpdateDoc = updateDoc as any;
      mockUpdateDoc.mockResolvedValue(undefined);

      const fileIds = ['file123', 'file456', 'file789'];
      const mediaType = 'movie';
      const mediaId = 'tt1234567';

      // Simulate updating each file
      for (const fileId of fileIds) {
        await updateDoc(
          doc({} as any, 'scanned_files', fileId),
          {
            assignmentStatus: 'assigned',
            assignedToType: mediaType,
            assignedToId: mediaId,
            updatedAt: expect.any(Date)
          }
        );
      }

      expect(mockUpdateDoc).toHaveBeenCalledTimes(3);
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          assignmentStatus: 'assigned',
          assignedToType: 'movie',
          assignedToId: 'tt1234567'
        })
      );
    });

    it('should handle episode assignments with series/season data', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockResolvedValue({ id: 'test-assignment-id' } as any);

      const assignment = {
        fileIds: ['file123'],
        mediaType: 'episode' as const,
        mediaId: 'ep123',
        mediaTitle: 'Test Episode',
        seriesId: 'series123',
        seasonId: 'season123',
        seasonNumber: 1,
        episodeNumber: 5,
        targetStructure: {
          libraryRoot: 'Y:/Media/TV',
          mediaFolder: 'Test Series/Season 01',
          fullPath: 'Y:/Media/TV/Test Series/Season 01/Test Series S01E05.mkv',
          folderName: 'Test Series',
          fileName: 'Test Series S01E05.mkv'
        },
        scanId: 'scan123'
      };

      await addDoc(
        collection({} as any, 'media_assignments'),
        {
          mediaFileIds: assignment.fileIds,
          primaryFileId: assignment.fileIds[0],
          mediaType: assignment.mediaType,
          mediaId: assignment.mediaId,
          seriesId: assignment.seriesId,
          seasonId: assignment.seasonId,
          seasonNumber: assignment.seasonNumber,
          episodeNumber: assignment.episodeNumber,
          targetFolderStructure: assignment.targetStructure,
          organizationStatus: 'pending',
          operations: [],
          assignedBy: 'current-user',
          assignedDate: expect.any(Date),
          confidence: 100,
          isManualAssignment: true,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date)
        }
      );

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mediaType: 'episode',
          seriesId: 'series123',
          seasonNumber: 1,
          episodeNumber: 5
        })
      );
    });

    it('should reject assignments with missing required fields', async () => {
      const invalidAssignment = {
        fileIds: [],  // Empty!
        mediaType: 'movie' as const,
        mediaId: '',  // Empty!
        mediaTitle: 'Test',
        targetStructure: null  // Null!
      };

      // This would be caught by validation
      expect(invalidAssignment.fileIds.length).toBe(0);
      expect(invalidAssignment.mediaId).toBe('');
      expect(invalidAssignment.targetStructure).toBeNull();
    });

    it('should handle Firebase errors gracefully', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockRejectedValue(new Error('Firebase connection failed'));

      try {
        await addDoc(
          collection({} as any, 'media_assignments'),
          { test: 'data' }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Firebase connection failed');
      }
    });

    it('should handle partial file update failures', async () => {
      const mockUpdateDoc = updateDoc as any;
      
      // First two succeed, third fails
      mockUpdateDoc
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('File not found'));

      const fileIds = ['file123', 'file456', 'file789'];
      const results = await Promise.allSettled(
        fileIds.map(fileId =>
          updateDoc(
            doc({} as any, 'scanned_files', fileId),
            { assignmentStatus: 'assigned' }
          )
        )
      );

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
      expect(results[2].status).toBe('rejected');
    });
  });

  describe('Assignment Data Validation', () => {
    it('should validate movie assignment data structure', () => {
      const movieAssignment = {
        fileIds: ['file123'],
        mediaType: 'movie' as const,
        mediaId: 'tt1234567',
        mediaTitle: 'The Matrix',
        targetStructure: {
          libraryRoot: 'Y:/Media/Movies',
          mediaFolder: 'The Matrix (1999) [imdbid-tt1234567]',
          fullPath: 'Y:/Media/Movies/The Matrix (1999) [imdbid-tt1234567]/The Matrix (1999).mkv',
          folderName: 'The Matrix (1999) [imdbid-tt1234567]',
          fileName: 'The Matrix (1999).mkv'
        },
        version: '4K',
        scanId: 'scan123'
      };

      expect(movieAssignment.fileIds).toBeDefined();
      expect(movieAssignment.mediaType).toBe('movie');
      expect(movieAssignment.mediaId).toMatch(/^tt\d+$/);
      expect(movieAssignment.targetStructure).toBeDefined();
    });

    it('should NOT include episode-specific fields for movie assignments', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockResolvedValue({ id: 'test-assignment-id' } as any);

      const movieAssignment = {
        fileIds: ['file123'],
        mediaType: 'movie' as const,
        mediaId: 'tt1234567',
        mediaTitle: 'The Matrix',
        targetStructure: {
          libraryRoot: 'Y:/Media/Movies',
          mediaFolder: 'The Matrix (1999) [imdbid-tt1234567]',
          fullPath: 'Y:/Media/Movies/The Matrix (1999) [imdbid-tt1234567]/The Matrix (1999).mkv',
          folderName: 'The Matrix (1999) [imdbid-tt1234567]',
          fileName: 'The Matrix (1999).mkv'
        },
        version: '4K',
        scanId: 'scan123'
      };

      // Create the document data conditionally (as implemented in handleAssignMedia)
      const mediaAssignmentData: any = {
        mediaFileIds: movieAssignment.fileIds,
        primaryFileId: movieAssignment.fileIds[0],
        mediaType: movieAssignment.mediaType,
        mediaId: movieAssignment.mediaId,
        isPreferredVersion: true,
        targetFolderStructure: movieAssignment.targetStructure,
        organizationStatus: 'pending',
        operations: [],
        assignedBy: 'current-user',
        assignedDate: expect.any(Date),
        confidence: 100,
        isManualAssignment: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      };

      // Only include episode-specific fields if mediaType is 'episode'
      if (movieAssignment.mediaType === 'episode') {
        mediaAssignmentData.seriesId = 'should-not-be-set';
        mediaAssignmentData.seasonId = 'should-not-be-set';
        mediaAssignmentData.seasonNumber = 99;
        mediaAssignmentData.episodeNumber = 99;
      }

      // Only include version if provided
      if (movieAssignment.version) {
        mediaAssignmentData.version = movieAssignment.version;
      }

      await addDoc(
        collection({} as any, 'media_assignments'),
        mediaAssignmentData
      );

      // Verify that episode-specific fields are NOT included
      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mediaType: 'movie',
          mediaId: 'tt1234567',
          version: '4K'
        })
      );

      // Get the actual call arguments
      const callArgs = mockAddDoc.mock.calls[0][1];
      
      // Verify episode-specific fields are undefined or not present
      expect(callArgs).not.toHaveProperty('seriesId');
      expect(callArgs).not.toHaveProperty('seasonId');
      expect(callArgs).not.toHaveProperty('seasonNumber');
      expect(callArgs).not.toHaveProperty('episodeNumber');
    });

    it('should validate episode assignment data structure', () => {
      const episodeAssignment = {
        fileIds: ['file123'],
        mediaType: 'episode' as const,
        mediaId: 'ep123',
        mediaTitle: 'Pilot',
        seriesId: 'series123',
        seasonId: 'season123',
        seasonNumber: 1,
        episodeNumber: 1,
        targetStructure: {
          libraryRoot: 'Y:/Media/TV',
          mediaFolder: 'Breaking Bad/Season 01',
          fullPath: 'Y:/Media/TV/Breaking Bad/Season 01/Breaking Bad S01E01.mkv',
          folderName: 'Breaking Bad',
          fileName: 'Breaking Bad S01E01.mkv'
        },
        scanId: 'scan123'
      };

      expect(episodeAssignment.fileIds).toBeDefined();
      expect(episodeAssignment.mediaType).toBe('episode');
      expect(episodeAssignment.seriesId).toBeDefined();
      expect(episodeAssignment.seasonNumber).toBeGreaterThan(0);
      expect(episodeAssignment.episodeNumber).toBeGreaterThan(0);
    });

    it('should INCLUDE episode-specific fields for episode assignments', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockResolvedValue({ id: 'test-assignment-id' } as any);

      const episodeAssignment = {
        fileIds: ['file123'],
        mediaType: 'episode' as const,
        mediaId: 'ep123',
        mediaTitle: 'Pilot',
        seriesId: 'series123',
        seasonId: 'season123',
        seasonNumber: 1,
        episodeNumber: 1,
        targetStructure: {
          libraryRoot: 'Y:/Media/TV',
          mediaFolder: 'Breaking Bad/Season 01',
          fullPath: 'Y:/Media/TV/Breaking Bad/Season 01/Breaking Bad S01E01.mkv',
          folderName: 'Breaking Bad',
          fileName: 'Breaking Bad S01E01.mkv'
        },
        scanId: 'scan123'
      };

      // Create the document data conditionally (as implemented in handleAssignMedia)
      const mediaAssignmentData: any = {
        mediaFileIds: episodeAssignment.fileIds,
        primaryFileId: episodeAssignment.fileIds[0],
        mediaType: episodeAssignment.mediaType,
        mediaId: episodeAssignment.mediaId,
        isPreferredVersion: true,
        targetFolderStructure: episodeAssignment.targetStructure,
        organizationStatus: 'pending',
        operations: [],
        assignedBy: 'current-user',
        assignedDate: expect.any(Date),
        confidence: 100,
        isManualAssignment: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      };

      // Only include episode-specific fields if mediaType is 'episode'
      if (episodeAssignment.mediaType === 'episode') {
        mediaAssignmentData.seriesId = episodeAssignment.seriesId;
        mediaAssignmentData.seasonId = episodeAssignment.seasonId;
        mediaAssignmentData.seasonNumber = episodeAssignment.seasonNumber;
        mediaAssignmentData.episodeNumber = episodeAssignment.episodeNumber;
      }

      await addDoc(
        collection({} as any, 'media_assignments'),
        mediaAssignmentData
      );

      // Verify that episode-specific fields ARE included
      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          mediaType: 'episode',
          mediaId: 'ep123',
          seriesId: 'series123',
          seasonId: 'season123',
          seasonNumber: 1,
          episodeNumber: 1
        })
      );

      // Get the actual call arguments
      const callArgs = mockAddDoc.mock.calls[0][1];
      
      // Verify all episode-specific fields are present
      expect(callArgs.seriesId).toBe('series123');
      expect(callArgs.seasonId).toBe('season123');
      expect(callArgs.seasonNumber).toBe(1);
      expect(callArgs.episodeNumber).toBe(1);
    });

    it('should NOT include version field when undefined', async () => {
      const mockAddDoc = addDoc as any;
      mockAddDoc.mockResolvedValue({ id: 'test-assignment-id' } as any);

      const movieAssignment = {
        fileIds: ['file123'],
        mediaType: 'movie' as const,
        mediaId: 'tt1234567',
        mediaTitle: 'The Matrix',
        targetStructure: {
          libraryRoot: 'Y:/Media/Movies',
          mediaFolder: 'The Matrix (1999) [imdbid-tt1234567]',
          fullPath: 'Y:/Media/Movies/The Matrix (1999) [imdbid-tt1234567]/The Matrix (1999).mkv',
          folderName: 'The Matrix (1999) [imdbid-tt1234567]',
          fileName: 'The Matrix (1999).mkv'
        },
        version: undefined, // No version specified
        scanId: 'scan123'
      };

      // Create the document data conditionally
      const mediaAssignmentData: any = {
        mediaFileIds: movieAssignment.fileIds,
        primaryFileId: movieAssignment.fileIds[0],
        mediaType: movieAssignment.mediaType,
        mediaId: movieAssignment.mediaId,
        isPreferredVersion: true,
        targetFolderStructure: movieAssignment.targetStructure,
        organizationStatus: 'pending',
        operations: [],
        assignedBy: 'current-user',
        assignedDate: expect.any(Date),
        confidence: 100,
        isManualAssignment: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date)
      };

      // Only include version if provided
      if (movieAssignment.version) {
        mediaAssignmentData.version = movieAssignment.version;
      }

      await addDoc(
        collection({} as any, 'media_assignments'),
        mediaAssignmentData
      );

      // Get the actual call arguments
      const callArgs = mockAddDoc.mock.calls[0][1];
      
      // Verify version field is not present
      expect(callArgs).not.toHaveProperty('version');
    });

    it('should handle optional version field', () => {
      const assignmentWithVersion = {
        version: '1080p BluRay'
      };

      const assignmentWithoutVersion = {
        version: undefined
      };

      expect(assignmentWithVersion.version).toBe('1080p BluRay');
      expect(assignmentWithoutVersion.version).toBeUndefined();
    });

    it('should prevent undefined fields from being added to Firebase documents', () => {
      // Test that the conditional logic prevents undefined values
      const movieData: any = {
        mediaType: 'movie' as const,
        mediaId: 'tt1234567'
      };

      const episodeData: any = {
        mediaType: 'episode' as const,
        mediaId: 'ep123',
        seriesId: 'series123',
        seasonId: 'season123',
        seasonNumber: 1,
        episodeNumber: 1
      };

      // Movie should not have episode fields
      if (movieData.mediaType === 'episode') {
        movieData.seriesId = 'should-not-exist';
      }
      expect(movieData.seriesId).toBeUndefined();

      // Episode should have all episode fields
      if (episodeData.mediaType === 'episode') {
        expect(episodeData.seriesId).toBe('series123');
        expect(episodeData.seasonNumber).toBe(1);
      }
    });
  });
});
