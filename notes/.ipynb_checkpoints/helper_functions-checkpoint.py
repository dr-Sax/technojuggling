import yt_dlp
import subprocess
import os

def display_videos(youtube_urls):
    html = '<div style="display: flex; gap: 10px; flex-wrap: wrap;">'
    width = 300
    height = 225  # 16:9 aspect ratio for width=300

    for url in youtube_urls:
        # Extract video ID from URL
        video_id = url.split('watch?v=')[-1].split('&')[0]
        
        html += f"""
        <figure style="text-align: center; margin: 0;">
            <iframe width="{width}" 
                    height="{height}" 
                    src="https://www.youtube.com/embed/{video_id}" 
                    frameborder="0" 
                    allow="autoplay; encrypted-media" 
                    allowfullscreen
                    style="border: 1px solid #ccc;">
            </iframe>
            <figcaption style="text-align: center; margin-top: 10px;">
                <a href="{url}">Watch on YouTube</a>
            </figcaption>
        </figure>
        """
    
    html += '</div>'
    return html

def display_videofiles(directory_path):
    filenames = [f for f in os.listdir(directory_path) if os.path.isfile(os.path.join(directory_path, f))]
    html = '<div style="display: flex; gap: 10px; flex-wrap: wrap;">'
    width = 300
    height = 400
    for fn in filenames:
        url = directory_path + '/' + fn
        html += f"""
        <figure style="text-align: center; margin: 0;">
            <video width="{width}" height="{height}" controls loop style="border: 1px solid #ccc;">
                <source src="{url}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <figcaption style="text-align: center; margin-top: 10px;">
                <a href="{url}">'{fn}'</a>
            </figcaption>
        </figure>
        """
    html += '</div>'
    return html

def display_images(media_url_list):
    html = '<div style="display: flex; gap: 10px; flex-wrap: wrap;">'
    width = 300
    height = 400
    for url in media_url_list:
        html += f"""
        <figure style="text-align: center; margin: 0;">
            <img src="{url}" width="{width}" height="{height}" style="border: 1px solid #ccc;"></img>
            <figcaption style="text-align: center; margin-top: 10px;">
                <a href="{url}">hiiiiiii :3</a>
            </figcaption>
        </figure>
        """
    html += '</div>'
    return html

def youtube_player_advanced(video_id, start_time=0, end_time=10, width=640, height=360, loop=True):
    """
    Advanced YouTube player with looping support for time range
    """
    
    player_id = f"player_{video_id}_{start_time}_{end_time}"
    
    html = f"""
    <div id="{player_id}"></div>
    <script src="https://www.youtube.com/iframe_api"></script>
    <script>
        var player_{video_id};
        var done_{video_id} = false;
        
        function onYouTubeIframeAPIReady() {{
            player_{video_id} = new YT.Player('{player_id}', {{
                height: '{height}',
                width: '{width}',
                videoId: '{video_id}',
                playerVars: {{
                    'start': {start_time},
                    'end': {end_time},
                    'autoplay': 1,
                    'controls': 1
                }},
                events: {{
                    'onReady': onPlayerReady_{video_id},
                    'onStateChange': onPlayerStateChange_{video_id}
                }}
            }});
        }}
        
        function onPlayerReady_{video_id}(event) {{
            event.target.playVideo();
        }}
        
        function onPlayerStateChange_{video_id}(event) {{
            // YT.PlayerState.ENDED = 0
            if (event.data == YT.PlayerState.ENDED && {str(loop).lower()}) {{
                player_{video_id}.seekTo({start_time});
                player_{video_id}.playVideo();
            }}
        }}
        
        // Call the API ready function
        if (typeof YT !== 'undefined' && YT.loaded) {{
            onYouTubeIframeAPIReady();
        }}
    </script>
    """
    
    return html

def display_webvideos(media_url_list):
    html = '<div style="display: flex; gap: 10px; flex-wrap: wrap;">'
    width = 300
    height = 400
    
    for url in media_url_list:
        # Extract filename for caption
        filename = url.split('/')[-1].replace('.mp4', '').replace('_', ' ')
        
        html += f"""
        <figure style="text-align: center; margin: 0;">
            <video width="{width}" height="{height}" controls autoplay loop style="border: 1px solid #ccc;">
                <source src="{url}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <figcaption style="text-align: center; margin-top: 10px;">
                <a href="{url}" target="_blank">{filename}</a>
            </figcaption>
        </figure>
        """
    
    html += '</div>'

    return html


    