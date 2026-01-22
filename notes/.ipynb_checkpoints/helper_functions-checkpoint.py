import yt_dlp
import subprocess

def yt_dlp_html(youtube_url):
    # Get direct video URL
    print('hi')
    result = subprocess.run(
        ['yt-dlp', '-f', '18', '-g', youtube_url], 
        capture_output=True, 
        text=True
    )
    video_url = result.stdout.strip()
    print(video_url)
    
    
    # Display videos side by side
    html = '<div style="display: flex; gap: 10px; flex-wrap: wrap;">'
    width = 400
    height = 300
    
    html += f"""
    <figure style="text-align: center; margin: 0;">
        <video width="{width}" height="{height}" controls loop autoplay style="border: 1px solid #ccc;">
            <source src="{video_url}" type="video/mp4">
            Your browser does not support the video tag.
        </video>
        <figcaption style="text-align: center; margin-top: 10px;">
            <a href="{video_url}">hi</a>
        </figcaption>
    </figure>
    """
    
    html += '</div>'

    return html
    