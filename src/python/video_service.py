"""
Video URL service - fetches YouTube video URLs using yt-dlp
Runs in thread pool to avoid blocking the event loop
"""
import yt_dlp
import asyncio
from concurrent.futures import ThreadPoolExecutor

class VideoService:
    def __init__(self):
        self.ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'quiet': True,
            'no_warnings': True,
        }
        self.executor = ThreadPoolExecutor(max_workers=2)
    
    def _fetch_video_url_sync(self, youtube_url):
        """
        Synchronous video URL fetch (runs in thread pool)
        """
        try:
            with yt_dlp.YoutubeDL(self.ydl_opts) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
                
                video_url = None
                formats = info.get('formats', [])
                
                # Try to find progressive MP4 (video + audio)
                for fmt in formats:
                    if (fmt.get('ext') == 'mp4' and 
                        fmt.get('vcodec') != 'none' and 
                        fmt.get('acodec') != 'none' and
                        fmt.get('protocol') in ['https', 'http']):
                        video_url = fmt['url']
                        break
                
                # Fallback: video-only MP4
                if not video_url:
                    for fmt in formats:
                        if (fmt.get('ext') == 'mp4' and 
                            fmt.get('vcodec') != 'none' and
                            fmt.get('protocol') in ['https', 'http']):
                            video_url = fmt['url']
                            break
                
                # Last resort: any URL
                if not video_url:
                    video_url = info.get('url')
                
                if video_url:
                    return {
                        'success': True,
                        'url': video_url,
                        'title': info.get('title')
                    }
                else:
                    return {
                        'success': False,
                        'error': 'Could not find streamable format'
                    }
                    
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    async def get_video_url(self, youtube_url):
        """
        Async wrapper that runs yt-dlp in thread pool
        """
        print(f"[VIDEO] Fetching URL for: {youtube_url}")
        
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            self.executor,
            self._fetch_video_url_sync,
            youtube_url
        )
        
        if result['success']:
            print(f"[VIDEO] Success: {result.get('title')}")
        else:
            print(f"[VIDEO] Failed: {result.get('error')}")
        
        return result