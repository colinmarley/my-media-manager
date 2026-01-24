"""
Enhanced media metadata extractor for video, audio, and subtitle tracks.
Extracts comprehensive technical specifications to populate MediaFile interface.
"""

import os
from typing import Dict, Any, List, Optional
from pymediainfo import MediaInfo
import ffmpeg

from utils.logging import logger


class MediaMetadataExtractor:
    """Extract comprehensive media metadata using pymediainfo and ffprobe"""
    
    def __init__(self):
        self.supported_video_formats = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.ts', '.m2ts']
        self.supported_audio_formats = ['.mp3', '.flac', '.aac', '.m4a', '.wav', '.ogg']
        self.supported_subtitle_formats = ['.srt', '.ass', '.ssa', '.sub', '.idx']
    
    def extract_full_metadata(self, file_path: str) -> Dict[str, Any]:
        """
        Extract comprehensive metadata for a media file.
        Returns dict matching MediaFile TypeScript interface.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Initialize metadata structure
        metadata = {
            'videoMetadata': None,
            'audioTracks': [],
            'subtitleTracks': [],
            'containerFormat': None,
            'overallBitrate': None
        }
        
        # Extract based on file type
        if file_ext in self.supported_video_formats:
            metadata = self._extract_video_metadata(file_path)
        elif file_ext in self.supported_audio_formats:
            metadata = self._extract_audio_only_metadata(file_path)
        elif file_ext in self.supported_subtitle_formats:
            metadata = self._extract_subtitle_metadata(file_path)
        
        return metadata
    
    def _extract_video_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract metadata from video files (mkv, mp4, etc.)"""
        try:
            media_info = MediaInfo.parse(file_path)
            
            metadata = {
                'videoMetadata': None,
                'audioTracks': [],
                'subtitleTracks': [],
                'containerFormat': None,
                'overallBitrate': None,
                'duration': None
            }
            
            # Extract general container info
            for track in media_info.tracks:
                if track.track_type == 'General':
                    metadata['containerFormat'] = track.format or track.file_extension
                    metadata['overallBitrate'] = track.overall_bit_rate
                    metadata['duration'] = track.duration  # in milliseconds
            
            # Extract video track info
            for track in media_info.tracks:
                if track.track_type == 'Video':
                    metadata['videoMetadata'] = self._parse_video_track(track)
                    break  # Use first video track
            
            # Extract audio tracks
            for track in media_info.tracks:
                if track.track_type == 'Audio':
                    audio_track = self._parse_audio_track(track)
                    metadata['audioTracks'].append(audio_track)
            
            # Extract subtitle tracks
            for track in media_info.tracks:
                if track.track_type == 'Text':
                    subtitle_track = self._parse_subtitle_track(track)
                    metadata['subtitleTracks'].append(subtitle_track)
            
            return metadata
            
        except Exception as e:
            logger.error("Video metadata extraction failed", path=file_path, error=str(e))
            return {
                'videoMetadata': None,
                'audioTracks': [],
                'subtitleTracks': [],
                'containerFormat': None,
                'overallBitrate': None
            }
    
    def _parse_video_track(self, track) -> Dict[str, Any]:
        """Parse video track information"""
        # Detect HDR
        hdr_format = None
        if hasattr(track, 'hdr_format'):
            hdr_format = track.hdr_format
        elif hasattr(track, 'color_primaries'):
            if 'BT.2020' in str(track.color_primaries):
                hdr_format = 'HDR10'  # Simplified detection
        
        # Detect 3D
        is_3d = False
        stereoscopic_mode = None
        if hasattr(track, 'multiview_layout'):
            is_3d = True
            stereoscopic_mode = track.multiview_layout
        
        # Resolution string (e.g., "1920x1080")
        resolution = None
        if track.width and track.height:
            resolution = f"{track.width}x{track.height}"
        
        # Determine resolution category
        resolution_category = self._categorize_resolution(track.width, track.height)
        
        return {
            'duration': track.duration,  # milliseconds
            'codec': track.format or track.codec_id,
            'codecProfile': track.format_profile if hasattr(track, 'format_profile') else None,
            'bitrate': track.bit_rate,
            'width': track.width,
            'height': track.height,
            'resolution': resolution,
            'resolutionCategory': resolution_category,
            'aspectRatio': track.display_aspect_ratio if hasattr(track, 'display_aspect_ratio') else None,
            'frameRate': float(track.frame_rate) if track.frame_rate else None,
            'frameRateMode': track.frame_rate_mode if hasattr(track, 'frame_rate_mode') else None,
            'colorSpace': track.color_space if hasattr(track, 'color_space') else None,
            'colorPrimaries': track.color_primaries if hasattr(track, 'color_primaries') else None,
            'transferCharacteristics': track.transfer_characteristics if hasattr(track, 'transfer_characteristics') else None,
            'hdrFormat': hdr_format,
            'is3D': is_3d,
            'stereoscopicMode': stereoscopic_mode,
            'scanType': track.scan_type if hasattr(track, 'scan_type') else None
        }
    
    def _parse_audio_track(self, track) -> Dict[str, Any]:
        """Parse audio track information"""
        # Determine if track is default/forced
        is_default = False
        is_forced = False
        
        if hasattr(track, 'default'):
            is_default = track.default == 'Yes'
        if hasattr(track, 'forced'):
            is_forced = track.forced == 'Yes'
        
        # Get language
        language = track.language if hasattr(track, 'language') else 'und'
        language_name = track.language_string if hasattr(track, 'language_string') else None
        
        # Get channel configuration
        channels = track.channel_s if hasattr(track, 'channel_s') else None
        channel_layout = track.channel_layout if hasattr(track, 'channel_layout') else None
        
        return {
            'trackId': track.track_id if hasattr(track, 'track_id') else None,
            'codec': track.format or track.codec_id,
            'codecProfile': track.format_profile if hasattr(track, 'format_profile') else None,
            'channels': channels,
            'channelLayout': channel_layout,
            'sampleRate': track.sampling_rate if hasattr(track, 'sampling_rate') else None,
            'bitrate': track.bit_rate,
            'bitrateMode': track.bit_rate_mode if hasattr(track, 'bit_rate_mode') else None,
            'language': language,
            'languageName': language_name,
            'title': track.title if hasattr(track, 'title') else None,
            'isDefault': is_default,
            'isForced': is_forced,
            'isExternal': False  # Internal tracks from container
        }
    
    def _parse_subtitle_track(self, track) -> Dict[str, Any]:
        """Parse subtitle/text track information"""
        # Determine if track is default/forced/SDH
        is_default = False
        is_forced = False
        is_sdh = False
        
        if hasattr(track, 'default'):
            is_default = track.default == 'Yes'
        if hasattr(track, 'forced'):
            is_forced = track.forced == 'Yes'
        
        # Check title for SDH indicators
        title = track.title if hasattr(track, 'title') else ''
        if title and any(indicator in title.lower() for indicator in ['sdh', 'hearing impaired', 'cc']):
            is_sdh = True
        
        # Get language
        language = track.language if hasattr(track, 'language') else 'und'
        language_name = track.language_string if hasattr(track, 'language_string') else None
        
        return {
            'trackId': track.track_id if hasattr(track, 'track_id') else None,
            'format': track.format or track.codec_id,
            'language': language,
            'languageName': language_name,
            'title': title,
            'isSDH': is_sdh,
            'isForced': is_forced,
            'isDefault': is_default,
            'isExternal': False  # Internal tracks from container
        }
    
    def _extract_audio_only_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract metadata from audio-only files"""
        try:
            media_info = MediaInfo.parse(file_path)
            
            metadata = {
                'videoMetadata': None,
                'audioTracks': [],
                'subtitleTracks': [],
                'containerFormat': None,
                'overallBitrate': None,
                'duration': None
            }
            
            # Extract general info
            for track in media_info.tracks:
                if track.track_type == 'General':
                    metadata['containerFormat'] = track.format
                    metadata['overallBitrate'] = track.overall_bit_rate
                    metadata['duration'] = track.duration
            
            # Extract audio track
            for track in media_info.tracks:
                if track.track_type == 'Audio':
                    audio_track = self._parse_audio_track(track)
                    metadata['audioTracks'].append(audio_track)
            
            return metadata
            
        except Exception as e:
            logger.error("Audio metadata extraction failed", path=file_path, error=str(e))
            return {
                'videoMetadata': None,
                'audioTracks': [],
                'subtitleTracks': [],
                'containerFormat': None,
                'overallBitrate': None
            }
    
    def _extract_subtitle_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract metadata from standalone subtitle files"""
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Parse filename for language hints
        filename = os.path.basename(file_path)
        language = self._detect_language_from_filename(filename)
        
        return {
            'videoMetadata': None,
            'audioTracks': [],
            'subtitleTracks': [{
                'trackId': None,
                'format': file_ext[1:].upper(),  # Remove dot, uppercase
                'language': language,
                'languageName': None,
                'title': None,
                'isSDH': 'sdh' in filename.lower() or 'cc' in filename.lower(),
                'isForced': 'forced' in filename.lower(),
                'isDefault': False,
                'isExternal': True  # Standalone subtitle file
            }],
            'containerFormat': file_ext[1:].upper(),
            'overallBitrate': None,
            'duration': None
        }
    
    def _categorize_resolution(self, width: Optional[int], height: Optional[int]) -> Optional[str]:
        """Categorize resolution into standard names (480p, 720p, 1080p, 4K, 8K)"""
        if not height:
            return None
        
        if height <= 480:
            return '480p'
        elif height <= 576:
            return '576p'
        elif height <= 720:
            return '720p'
        elif height <= 1080:
            return '1080p'
        elif height <= 1440:
            return '1440p'
        elif height <= 2160:
            return '4K'
        elif height <= 4320:
            return '8K'
        else:
            return f'{height}p'
    
    def _detect_language_from_filename(self, filename: str) -> str:
        """Detect language from filename patterns (e.g., .en.srt, .spa.srt)"""
        language_codes = {
            'en': 'eng', 'eng': 'eng', 'english': 'eng',
            'es': 'spa', 'spa': 'spa', 'spanish': 'spa',
            'fr': 'fra', 'fra': 'fra', 'french': 'fra',
            'de': 'deu', 'ger': 'deu', 'german': 'deu',
            'it': 'ita', 'ita': 'ita', 'italian': 'ita',
            'ja': 'jpn', 'jpn': 'jpn', 'japanese': 'jpn',
            'zh': 'chi', 'chi': 'chi', 'chinese': 'chi',
            'pt': 'por', 'por': 'por', 'portuguese': 'por',
            'ru': 'rus', 'rus': 'rus', 'russian': 'rus',
            'ko': 'kor', 'kor': 'kor', 'korean': 'kor'
        }
        
        filename_lower = filename.lower()
        for code, iso_code in language_codes.items():
            if f'.{code}.' in filename_lower or f'_{code}_' in filename_lower:
                return iso_code
        
        return 'und'  # undefined
    
    def get_video_thumbnail_timestamp(self, duration_ms: Optional[int]) -> int:
        """
        Calculate optimal timestamp for thumbnail extraction (20% into the video).
        Returns timestamp in seconds.
        """
        if not duration_ms:
            return 30  # Default to 30 seconds
        
        duration_seconds = duration_ms / 1000
        # Get timestamp at 20% into the video (skip intros)
        thumbnail_time = int(duration_seconds * 0.2)
        return max(10, min(thumbnail_time, 300))  # Between 10s and 5min
