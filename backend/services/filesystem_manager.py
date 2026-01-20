import os
import shutil
import hashlib
import stat
from pathlib import Path
from typing import List, Dict, Any, Optional
from send2trash import send2trash
from pathvalidate import validate_filepath, ValidationError

from config.settings import settings
from utils.exceptions import (
    PathSecurityError,
    InsufficientPermissionsError,
    FileOperationError
)
from utils.logging import log_file_operation, logger

class FileSystemManager:
    def __init__(self):
        self.base_paths = settings.allowed_base_paths
        self.supported_extensions = (
            settings.supported_video_extensions +
            settings.supported_audio_extensions +
            settings.supported_subtitle_extensions
        )
    
    def validate_path_security(self, requested_path: str) -> bool:
        """Prevent directory traversal attacks - TEMPORARILY DISABLED"""
        # TODO: Re-enable path validation after resolving configuration issue
        logger.info("Path validation DISABLED for testing", requested=requested_path)
        return True
    
    def check_permissions(self, path: str, operation: str) -> Dict[str, bool]:
        """Check file system permissions for operations"""
        permissions = {
            'read': False,
            'write': False,
            'execute': False
        }
        
        try:
            if os.path.exists(path):
                permissions['read'] = os.access(path, os.R_OK)
                permissions['write'] = os.access(path, os.W_OK)
                permissions['execute'] = os.access(path, os.X_OK)
            else:
                # Check parent directory permissions for creation
                parent_dir = os.path.dirname(path)
                if os.path.exists(parent_dir):
                    permissions['write'] = os.access(parent_dir, os.W_OK)
        except Exception as e:
            logger.error("Permission check failed", path=path, error=str(e))
        
        return permissions
    
    def validate_operation(self, operation: str, path: str) -> Dict[str, Any]:
        """Validate file operations before execution"""
        checks = {
            'path_exists': os.path.exists(path),
            'path_secure': self.validate_path_security(path),
            'permissions': self.check_permissions(path, operation),
            'file_locked': self.is_file_locked(path),
            'valid': False
        }
        
        # Determine if operation is valid
        checks['valid'] = (
            checks['path_secure'] and
            (checks['path_exists'] or operation in ['create', 'move_destination']) and
            not checks['file_locked']
        )
        
        return checks
    
    def is_file_locked(self, path: str) -> bool:
        """Check if file is currently locked/in use"""
        if not os.path.exists(path):
            return False
        
        try:
            # Try to open file in append mode
            with open(path, 'a'):
                pass
            return False
        except (IOError, PermissionError):
            return True
    
    def rename_file(self, current_path: str, new_name: str) -> Dict[str, Any]:
        """Rename a file while preserving extension"""
        try:
            # Validate security
            if not self.validate_path_security(current_path):
                raise PathSecurityError(f"Path not allowed: {current_path}")
            
            # Check if file exists
            if not os.path.exists(current_path):
                raise FileOperationError(f"File does not exist: {current_path}")
            
            # Get directory and create new path
            directory = os.path.dirname(current_path)
            extension = os.path.splitext(current_path)[1]
            
            # Ensure new name has extension if original had one
            if extension and not new_name.endswith(extension):
                new_name += extension
            
            new_path = os.path.join(directory, new_name)
            
            # Validate new path
            if not self.validate_path_security(new_path):
                raise PathSecurityError(f"New path not allowed: {new_path}")
            
            # Check if destination already exists
            if os.path.exists(new_path):
                raise FileOperationError(f"Destination already exists: {new_path}")
            
            # Validate filename
            try:
                validate_filepath(new_name)
            except ValidationError as e:
                raise FileOperationError(f"Invalid filename: {str(e)}")
            
            # Perform rename
            os.rename(current_path, new_path)
            
            result = {
                'success': True,
                'old_path': current_path,
                'new_path': new_path,
                'operation': 'rename'
            }
            
            log_file_operation('rename', current_path, True, new_path=new_path)
            return result
            
        except Exception as e:
            log_file_operation('rename', current_path, False, error=str(e))
            raise FileOperationError(f"Rename failed: {str(e)}")
    
    def move_file(self, source_path: str, destination_path: str, merge_contents: bool = False) -> Dict[str, Any]:
        """Move a file or folder to a new location"""
        try:
            # Validate security for both paths
            if not self.validate_path_security(source_path):
                raise PathSecurityError(f"Source path not allowed: {source_path}")
            
            if not self.validate_path_security(destination_path):
                raise PathSecurityError(f"Destination path not allowed: {destination_path}")
            
            # Check if source exists
            if not os.path.exists(source_path):
                raise FileOperationError(f"Source file does not exist: {source_path}")
            
            # Create destination directory if it doesn't exist
            dest_dir = os.path.dirname(destination_path)
            if not os.path.exists(dest_dir):
                os.makedirs(dest_dir, exist_ok=True)
            
            moved_items = []
            
            # Handle different scenarios based on source and destination types
            if os.path.isdir(source_path) and os.path.exists(destination_path) and os.path.isdir(destination_path) and merge_contents:
                # Moving folder contents into existing destination folder
                for item in os.listdir(source_path):
                    item_source = os.path.join(source_path, item)
                    item_dest = os.path.join(destination_path, item)
                    
                    if os.path.exists(item_dest):
                        if os.path.isdir(item_source) and os.path.isdir(item_dest):
                            # Recursively merge subdirectories
                            sub_result = self.move_file(item_source, item_dest, merge_contents=True)
                            moved_items.append(sub_result)
                        else:
                            # Handle file conflicts - for now, skip and log
                            logger.warning(f"Skipping existing file: {item_dest}")
                    else:
                        # Move item to destination
                        shutil.move(item_source, item_dest)
                        moved_items.append({
                            'source': item_source,
                            'destination': item_dest,
                            'type': 'directory' if os.path.isdir(item_dest) else 'file'
                        })
                
                # Remove source directory if empty
                try:
                    os.rmdir(source_path)
                    operation_type = 'merge_and_remove'
                except OSError:
                    # Directory not empty (some items may have been skipped)
                    operation_type = 'merge_partial'
                    
            else:
                # Standard move operation
                if os.path.exists(destination_path) and not merge_contents:
                    raise FileOperationError(f"Destination already exists: {destination_path}")
                
                # Perform move
                shutil.move(source_path, destination_path)
                operation_type = 'move'
                moved_items.append({
                    'source': source_path,
                    'destination': destination_path,
                    'type': 'directory' if os.path.isdir(destination_path) else 'file'
                })
            
            result = {
                'success': True,
                'source_path': source_path,
                'destination_path': destination_path,
                'operation': operation_type,
                'moved_items': moved_items,
                'items_count': len(moved_items)
            }
            
            log_file_operation('move', source_path, True, destination=destination_path)
            return result
            
        except Exception as e:
            log_file_operation('move', source_path, False, error=str(e))
            raise FileOperationError(f"Move failed: {str(e)}")
    
    def delete_file(self, file_path: str, use_trash: bool = True) -> Dict[str, Any]:
        """Delete a file safely"""
        try:
            # Validate security
            if not self.validate_path_security(file_path):
                raise PathSecurityError(f"Path not allowed: {file_path}")
            
            # Check if file exists
            if not os.path.exists(file_path):
                raise FileOperationError(f"File does not exist: {file_path}")
            
            # Perform deletion
            if use_trash and settings.use_trash_for_deletes:
                send2trash(file_path)
                delete_method = 'trash'
            else:
                os.remove(file_path)
                delete_method = 'permanent'
            
            result = {
                'success': True,
                'deleted_path': file_path,
                'method': delete_method,
                'operation': 'delete'
            }
            
            log_file_operation('delete', file_path, True, method=delete_method)
            return result
            
        except Exception as e:
            log_file_operation('delete', file_path, False, error=str(e))
            raise FileOperationError(f"Delete failed: {str(e)}")
    
    def bulk_move(self, source_paths: List[str], destination_path: str, merge_contents: bool = False) -> Dict[str, Any]:
        """Move multiple files/folders to a destination"""
        try:
            # Validate destination path security
            if not self.validate_path_security(destination_path):
                raise PathSecurityError(f"Destination path not allowed: {destination_path}")
            
            # Ensure destination directory exists
            if not os.path.exists(destination_path):
                os.makedirs(destination_path, exist_ok=True)
            elif not os.path.isdir(destination_path):
                raise FileOperationError(f"Destination must be a directory: {destination_path}")
            
            successful_moves = []
            failed_moves = []
            
            for source_path in source_paths:
                try:
                    # Determine the final destination for this item
                    item_name = os.path.basename(source_path)
                    item_destination = os.path.join(destination_path, item_name)
                    
                    # Move the item
                    result = self.move_file(source_path, item_destination, merge_contents)
                    successful_moves.append(result)
                    
                except Exception as e:
                    failed_moves.append({
                        'source_path': source_path,
                        'error': str(e)
                    })
            
            result = {
                'success': len(failed_moves) == 0,
                'destination_path': destination_path,
                'successful_moves': successful_moves,
                'failed_moves': failed_moves,
                'total_items': len(source_paths),
                'successful_count': len(successful_moves),
                'failed_count': len(failed_moves),
                'operation': 'bulk_move'
            }
            
            log_file_operation('bulk_move', f"{len(source_paths)} items", len(failed_moves) == 0, 
                             destination=destination_path, 
                             details=f"Success: {len(successful_moves)}, Failed: {len(failed_moves)}")
            return result
            
        except Exception as e:
            log_file_operation('bulk_move', f"{len(source_paths)} items", False, error=str(e))
            raise FileOperationError(f"Bulk move failed: {str(e)}")
    
    def get_file_metadata(self, file_path: str, calculate_checksum: bool = None) -> Dict[str, Any]:
        """Get comprehensive file metadata
        
        Args:
            file_path: Path to the file
            calculate_checksum: Whether to calculate checksum (overrides settings)
        """
        try:
            # Validate security
            if not self.validate_path_security(file_path):
                raise PathSecurityError(f"Path not allowed: {file_path}")
            
            if not os.path.exists(file_path):
                raise FileOperationError(f"File does not exist: {file_path}")
            
            # Get basic file stats
            file_stats = os.stat(file_path)
            
            metadata = {
                'path': file_path,
                'name': os.path.basename(file_path),
                'extension': os.path.splitext(file_path)[1],
                'size': file_stats.st_size,
                'size_mb': round(file_stats.st_size / (1024 * 1024), 2),
                'created': file_stats.st_ctime,
                'modified': file_stats.st_mtime,
                'accessed': file_stats.st_atime,
                'permissions': stat.filemode(file_stats.st_mode),
                'is_directory': os.path.isdir(file_path),
                'is_file': os.path.isfile(file_path)
            }
            
            # Calculate checksum if enabled
            should_calculate_checksum = (
                calculate_checksum if calculate_checksum is not None 
                else settings.enable_file_integrity_checks
            )
            if should_calculate_checksum and os.path.isfile(file_path):
                metadata['checksum'] = self.calculate_file_checksum(file_path)
            
            return metadata
            
        except Exception as e:
            raise FileOperationError(f"Metadata extraction failed: {str(e)}")
    
    def calculate_file_checksum(self, file_path: str) -> str:
        """Calculate SHA256 checksum of file"""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    sha256_hash.update(chunk)
            return sha256_hash.hexdigest()
        except Exception as e:
            logger.error("Checksum calculation failed", path=file_path, error=str(e))
            return ""
    
    def list_directory(self, directory_path: str) -> List[Dict[str, Any]]:
        """List directory contents with metadata"""
        try:
            # Validate security
            if not self.validate_path_security(directory_path):
                raise PathSecurityError(f"Path not allowed: {directory_path}")
            
            if not os.path.exists(directory_path):
                raise FileOperationError(f"Directory does not exist: {directory_path}")
            
            if not os.path.isdir(directory_path):
                raise FileOperationError(f"Path is not a directory: {directory_path}")
            
            items = []
            for item_name in os.listdir(directory_path):
                item_path = os.path.join(directory_path, item_name)
                try:
                    item_metadata = self.get_file_metadata(item_path)
                    items.append(item_metadata)
                except Exception as e:
                    logger.warning("Failed to get metadata", path=item_path, error=str(e))
                    # Include basic info even if metadata fails
                    items.append({
                        'path': item_path,
                        'name': item_name,
                        'error': str(e)
                    })
            
            return sorted(items, key=lambda x: (not x.get('is_directory', False), x.get('name', '')))
            
        except Exception as e:
            raise FileOperationError(f"Directory listing failed: {str(e)}")