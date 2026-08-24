export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ComplianceStatus =
  | 'open'
  | 'ignored'
  | 'snoozed'
  | 'resolved'
  | 'needs_manual_review';

export interface ComplianceAction {
  id: string;
  actionType: 'rename' | 'move' | 'create_folder' | 'noop' | string;
  sourcePath?: string | null;
  targetPath?: string | null;
  payload: Record<string, unknown>;
  selected: boolean;
}

export interface ComplianceFinding {
  id: string;
  scanId: string;
  mediaType: string;
  mediaId?: string | null;
  folderPath?: string | null;
  filePath?: string | null;
  issueType: string;
  severity: ComplianceSeverity;
  confidence: number;
  currentState: Record<string, unknown>;
  expectedState: Record<string, unknown>;
  rationale?: string | null;
  status: ComplianceStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  actions: ComplianceAction[];
}

export interface ComplianceScanStatus {
  scanId: string;
  libraryPath: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  totalFolders: number;
  processedFolders: number;
  findingsCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  percentage: number;
}

export interface ComplianceSummary {
  open: number;
  critical: number;
  high: number;
  duplicateMain: number;
  misplacedSpecial: number;
  namingMismatch: number;
  seasonNamingMismatch?: number;
  episodeNamingMismatch?: number;
  specialsMisplaced?: number;
  unknownEpisodePattern?: number;
}

export interface CompliancePreview {
  findingId: string;
  actions: Array<{
    actionId: string;
    actionType: string;
    sourcePath?: string | null;
    targetPath?: string | null;
    sourceExists: boolean;
    targetExists: boolean;
    parentFolderExists: boolean;
    canApply: boolean;
  }>;
  safeToApply: boolean;
}

export interface ComplianceApplyResult {
  finding: ComplianceFinding;
  results: Array<{
    actionId: string;
    actionType: string;
    success: boolean;
    sourcePath?: string | null;
    targetPath?: string | null;
    error?: string;
  }>;
  success: boolean;
}
