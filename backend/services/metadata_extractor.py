import ffmpeg
import subprocess
import json
from typing import Dict, List, Any, Optional
from pathlib import Path

from config.settings import settings
from utils.exceptions import MetadataExtractionError
from utils.logging import logger

class MetadataExtractor:
    def __init__(self):
        self.ffprobe_path = settings.ffprobe_path
        self.ffmpeg_path = settings.ffmpeg_path
        self.timeout = settings.metadata_extraction_timeout
    
    def _find_ffprobe(self) -> str:
        """Find ffprobe executable path"""
        try:
            result = subprocess.run(
                ['which', 'ffprobe'], 
                capture_output=True, 
                text=True, 
                timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        
        # Fallback paths
        fallback_paths = [
            '/usr/bin/ffprobe',
            '/usr/local/bin/ffprobe',
            'ffprobe'  # System PATH
        ]
        
        for path in fallback_paths:
            try:
                subprocess.run([path, '-version'], capture_output=True, timeout=5)
                return path
            except Exception:
                continue
        
        raise MetadataExtractionError("ffprobe not found. Please install FFmpeg.")
    
    def extract_video_metadata(self, file_path: str) -> Dict[str, Any]:
        """Extract comprehensive video metadata using ffprobe"""
        try:
            # Use ffprobe to get metadata
            probe_result = ffmpeg.probe(
                file_path,
                cmd=self.ffprobe_path,
                timeout=self.timeout
            )
            
            # Extract basic video information
            video_stream = next(
                (stream for stream in probe_result['streams'] if stream['codec_type'] == 'video'),
                None
            )
            
            if not video_stream:
                raise MetadataExtractionError("No video stream found")
            
            metadata = {
                'format': probe_result.get('format', {}),
                'video': self._extract_video_stream_info(video_stream),
                'audio': self._extract_audio_streams(probe_result['streams']),
                'subtitle': self._extract_subtitle_streams(probe_result['streams']),
                'chapters': probe_result.get('chapters', []),
                'duration': float(probe_result['format'].get('duration', 0)),
                'size': int(probe_result['format'].get('size', 0)),
                'bitrate': int(probe_result['format'].get('bit_rate', 0))
            }
            
            return metadata
            
        except ffmpeg.Error as e:
            logger.error("FFprobe extraction failed", path=file_path, error=str(e))
            raise MetadataExtractionError(f"FFprobe failed: {str(e)}")
        except Exception as e:
            logger.error("Metadata extraction failed", path=file_path, error=str(e))
            raise MetadataExtractionError(f"Metadata extraction failed: {str(e)}")
    
    def _extract_video_stream_info(self, video_stream: Dict[str, Any]) -> Dict[str, Any]:
        """Extract video stream specific information"""
        return {
            'codec': video_stream.get('codec_name', ''),
            'codec_long': video_stream.get('codec_long_name', ''),
            'width': int(video_stream.get('width', 0)),
            'height': int(video_stream.get('height', 0)),
            'resolution': f"{video_stream.get('width', 0)}x{video_stream.get('height', 0)}",
            'aspect_ratio': video_stream.get('display_aspect_ratio', ''),
            'frame_rate': self._parse_frame_rate(video_stream.get('r_frame_rate', '')),
            'pixel_format': video_stream.get('pix_fmt', ''),
            'bitrate': int(video_stream.get('bit_rate', 0)),
            'profile': video_stream.get('profile', ''),
            'level': video_stream.get('level', ''),
            'color_space': video_stream.get('color_space', ''),
            'color_range': video_stream.get('color_range', '')
        }
    
    def _extract_audio_streams(self, streams: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract audio stream information"""
        audio_streams = []
        
        for stream in streams:
            if stream.get('codec_type') == 'audio':
                audio_info = {
                    'index': stream.get('index', 0),
                    'codec': stream.get('codec_name', ''),
                    'codec_long': stream.get('codec_long_name', ''),
                    'channels': int(stream.get('channels', 0)),
                    'channel_layout': stream.get('channel_layout', ''),
                    'sample_rate': int(stream.get('sample_rate', 0)),
                    'bitrate': int(stream.get('bit_rate', 0)),
                    'language': stream.get('tags', {}).get('language', 'unknown'),
                    'title': stream.get('tags', {}).get('title', ''),
                    'default': stream.get('disposition', {}).get('default', 0) == 1
                }
                audio_streams.append(audio_info)
        
        return audio_streams
    
    def _extract_subtitle_streams(self, streams: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract subtitle stream information"""
        subtitle_streams = []
        
        for stream in streams:
            if stream.get('codec_type') == 'subtitle':
                subtitle_info = {
                    'index': stream.get('index', 0),
                    'codec': stream.get('codec_name', ''),
                    'codec_long': stream.get('codec_long_name', ''),
                    'language': stream.get('tags', {}).get('language', 'unknown'),
                    'title': stream.get('tags', {}).get('title', ''),
                    'default': stream.get('disposition', {}).get('default', 0) == 1,
                    'forced': stream.get('disposition', {}).get('forced', 0) == 1
                }
                subtitle_streams.append(subtitle_info)
        
        return subtitle_streams
    
    def _parse_frame_rate(self, frame_rate_str: str) -> float:
        """Parse frame rate from string format (e.g., '24000/1001')"""
        try:
            if '/' in frame_rate_str:
                numerator, denominator = frame_rate_str.split('/')
                return float(numerator) / float(denominator)
            else:
                return float(frame_rate_str)
        except (ValueError, ZeroDivisionError):
            return 0.0
    
    def get_video_thumbnail(self, file_path: str, timestamp: float = 10.0) -> Optional[str]:
        """Generate video thumbnail at specified timestamp"""
        try:
            output_path = Path(settings.temp_directory) / f"thumb_{Path(file_path).stem}.jpg"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            (
                ffmpeg
                .input(file_path, ss=timestamp)
                .output(
                    str(output_path),
                    vframes=1,
                    format='image2',
                    vcodec='mjpeg'
                )
                .overwrite_output()
                .run(cmd=self.ffmpeg_path, capture_stdout=True, timeout=self.timeout)
            )
            
            return str(output_path)
            
        except Exception as e:
            logger.error("Thumbnail generation failed", path=file_path, error=str(e))
            return None
    
    def extract_file_metadata_batch(self, file_paths: List[str]) -> Dict[str, Any]:
        """Extract metadata from multiple files"""
        results = {}
        
        for file_path in file_paths:
            try:
                if self._is_video_file(file_path):
                    results[file_path] = self.extract_video_metadata(file_path)
                else:
                    results[file_path] = {'error': 'Unsupported file type'}
            except Exception as e:
                results[file_path] = {'error': str(e)}
        
        return results
    
    def _is_video_file(self, file_path: str) -> bool:
        """Check if file is a supported video format"""
        extension = Path(file_path).suffix.lower()
        return extension in settings.supported_video_extensions