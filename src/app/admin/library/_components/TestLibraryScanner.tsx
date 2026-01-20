import { useState } from 'react';
import { useLibraryScanner } from '../../../../hooks/library/useLibraryScanner';
import { LibraryPath } from '../../../../types/library/LibraryTypes';

const TestLibraryScanner = () => {
  const [testPath, setTestPath] = useState('/media/test');
  const { 
    isScanning, 
    scanProgress, 
    scanResults, 
    error, 
    startScan, 
    stopScan, 
    clearResults 
  } = useLibraryScanner();

  const handleStartScan = async () => {
    const libraryPath: LibraryPath = {
      id: 'test-library',
      name: 'Test Library',
      rootPath: testPath,
      mediaType: 'mixed',
      isActive: true,
      createdAt: new Date()
    };

    await startScan(libraryPath);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h2>Library Scanner Test</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <label>
          Test Path:
          <input
            type="text"
            value={testPath}
            onChange={(e) => setTestPath(e.target.value)}
            style={{ marginLeft: '10px', width: '300px' }}
          />
        </label>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={handleStartScan} disabled={isScanning}>
          {isScanning ? 'Scanning...' : 'Start Scan'}
        </button>
        <button onClick={stopScan} disabled={!isScanning} style={{ marginLeft: '10px' }}>
          Stop Scan
        </button>
        <button onClick={clearResults} style={{ marginLeft: '10px' }}>
          Clear Results
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      {isScanning && scanProgress && (
        <div style={{ backgroundColor: '#e3f2fd', padding: '10px', marginBottom: '20px' }}>
          <h3>Scan Progress</h3>
          <div>Status: {scanProgress.status}</div>
          <div>Current Path: {scanProgress.currentPath}</div>
          <div>Progress: {scanProgress.percentage}%</div>
          <div>Folders: {scanProgress.foldersProcessed} / {scanProgress.totalFolders}</div>
          <div>Files: {scanProgress.filesProcessed} / {scanProgress.totalFiles}</div>
        </div>
      )}

      {scanResults.length > 0 && (
        <div style={{ backgroundColor: '#f3e5f5', padding: '10px' }}>
          <h3>Scan Results</h3>
          {scanResults.map((result, index) => (
            <div key={index} style={{ marginBottom: '10px', border: '1px solid #ccc', padding: '10px' }}>
              <div><strong>Library:</strong> {result.libraryPath.name}</div>
              <div><strong>Status:</strong> {result.status}</div>
              <div><strong>Total Folders:</strong> {result.totalFolders}</div>
              <div><strong>Total Files:</strong> {result.totalFiles}</div>
              <div><strong>New Files:</strong> {result.newFiles}</div>
              <div><strong>Errors:</strong> {result.errors.length}</div>
              {result.errors.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                  <strong>Error Details:</strong>
                  {result.errors.map((error, errorIndex) => (
                    <div key={errorIndex} style={{ color: 'red', fontSize: '12px' }}>
                      {error.type}: {error.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TestLibraryScanner;