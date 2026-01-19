/**
 * Media utilities - detect media type and validate URLs
 */

const VIDEO_EXTENSIONS = [
  '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m3u8'
];

const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'
];

export class MediaUtils {
  /**
   * Detect if URL is a direct media URL (doesn't need backend conversion)
   */
  static isDirectUrl(url) {
    if (!url) return false;
    
    // Check if it's a local file path
    if (url.startsWith('file://') || url.startsWith('/') || url.includes(':\\')) {
      return true;
    }
    
    // Check if it's a direct HTTP(S) URL with media extension
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const lowerUrl = url.toLowerCase();
      return VIDEO_EXTENSIONS.some(ext => lowerUrl.includes(ext)) ||
             IMAGE_EXTENSIONS.some(ext => lowerUrl.includes(ext));
    }
    
    return false;
  }
  
  /**
   * Detect media type from URL or file path
   * @returns {'video' | 'image' | 'unknown'}
   */
  static getMediaType(url) {
    if (!url) return 'unknown';
    
    const lowerUrl = url.toLowerCase();
    
    if (VIDEO_EXTENSIONS.some(ext => lowerUrl.includes(ext))) {
      return 'video';
    }
    
    if (IMAGE_EXTENSIONS.some(ext => lowerUrl.includes(ext))) {
      return 'image';
    }
    
    return 'unknown';
  }
  
  /**
   * Check if URL needs backend processing (YouTube, etc.)
   */
  static needsBackendProcessing(url) {
    if (!url) return false;
    
    // YouTube URLs need backend processing
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return true;
    }
    
    // If it's not a direct URL, assume it needs processing
    return !this.isDirectUrl(url);
  }
}