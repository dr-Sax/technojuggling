"""
Video URL service - fetches YouTube video URLs using yt-dlp
"""
import yt_dlp

class VideoService:
    def __init__(self):
        self.ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'quiet': True,
            'no_warnings': True,
        }
    
    async def get_video_url(self, youtube_url):
        """
        Fetch direct video URL from YouTube URL
        Returns: dict with 'success', 'url', 'title', or 'error'
        """
        print(f"🎬 Fetching video URL for: {youtube_url}")
        
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
                    print(f"✓ Video URL fetched: {info.get('title')}")
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
            print(f"❌ Error fetching video URL: {e}")
            return {
                'success': False,
                'error': str(e)
            }