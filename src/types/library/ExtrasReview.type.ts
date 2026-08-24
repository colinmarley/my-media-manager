export interface PendingExtra {
  id: string;
  assignmentId: string;
  mediaFileId: string;
  category: string | null;
  source: string | null;
  confirmed: boolean;
  createdAt: string | null;
  fileName: string;
  filePath: string;
  fileSize: number | null;
}
