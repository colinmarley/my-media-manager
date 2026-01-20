class LibraryError(Exception):
    """Base exception for library operations"""
    pass

class PathSecurityError(LibraryError):
    """Path traversal or security violation"""
    pass

class InsufficientPermissionsError(LibraryError):
    """Insufficient file system permissions"""
    pass

class MetadataExtractionError(LibraryError):
    """Failed to extract media metadata"""
    pass

class ScanOperationError(LibraryError):
    """Error during library scanning operation"""
    pass

class FileOperationError(LibraryError):
    """Error during file operations (rename, move, delete)"""
    pass

class InvalidFileTypeError(LibraryError):
    """Unsupported file type for operation"""
    pass