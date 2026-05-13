"""
YouTube Resolver - Resolves YouTube URLs to direct stream URLs via yt-dlp.

Used by the WebSocket handler to let the frontend pass short YouTube links
(e.g. https://youtu.be/dQw4w9WgXcQ) as clip URLs, instead of pasting giant
m3u8 manifest URLs that expire and contain no titling info.

Resolved URLs are cached in memory by video ID. Cache entries get a TTL
because Google's googlevideo URLs typically expire after ~6 hours.

NOTE on format selection:
    Chrome/Electron's <video> element cannot play HLS (m3u8) or DASH manifests
    natively. We must request a *progressive* mp4 — a single file with audio
    and video muxed together — that the browser can stream directly. The
    format selector below filters out adaptive streams explicitly.
"""
import asyncio
import re
import time
from typing import Optional

try:
    from yt_dlp import YoutubeDL
except ImportError as e:
    raise ImportError(
        "yt-dlp is required. Install it in the Python venv:\n"
        "  pip install yt-dlp"
    ) from e


# Cache TTL — googlevideo URLs from Google typically expire after ~6h.
# We re-resolve after 4h to stay safely inside that window.
CACHE_TTL_SECONDS = 4 * 60 * 60


# Browser-compatible format selector.
#
# Filters explained:
#   protocol^=http    → excludes m3u8_native (HLS) and http_dash_segments (DASH)
#   acodec!=none      → must include an audio track
#   vcodec!=none      → must include a video track
#   ext=mp4           → browser-friendly container
#   height<=720       → quality cap (live coding doesn't need 4K)
#
# Fallback chain:
#   1. Best progressive mp4 ≤720p with audio+video
#   2. Any progressive mp4 with audio+video (in case nothing ≤720 qualifies)
#   3. itag 18  — YouTube's classic 360p mp4, almost always available
DEFAULT_FORMAT = (
    "best[ext=mp4][protocol^=http][acodec!=none][vcodec!=none][height<=720]/"
    "best[ext=mp4][protocol^=http][acodec!=none][vcodec!=none]/"
    "18"
)


# Regex for detecting YouTube URLs (mirrored on the frontend)
YOUTUBE_URL_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_video_id(url: str) -> Optional[str]:
    """Pull the 11-char YouTube video ID from any common URL form."""
    m = YOUTUBE_URL_RE.search(url)
    return m.group(1) if m else None


def is_youtube_url(url: str) -> bool:
    return extract_video_id(url) is not None


class YouTubeResolver:
    def __init__(self, format_selector: str = DEFAULT_FORMAT):
        self.format_selector = format_selector
        # video_id -> {stream_url, title, duration, resolved_at, ...}
        self._cache: dict = {}
        # video_id -> Future, so concurrent requests for the same video coalesce
        self._inflight: dict = {}

    def _cache_get(self, video_id: str) -> Optional[dict]:
        entry = self._cache.get(video_id)
        if not entry:
            return None
        if time.time() - entry["resolved_at"] > CACHE_TTL_SECONDS:
            self._cache.pop(video_id, None)
            return None
        return entry

    def _resolve_sync(self, url: str) -> dict:
        """Blocking yt-dlp call. Run inside a thread executor."""
        opts = {
            "format": self.format_selector,
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
        }
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        # extract_info returns a dict for a single video. For playlists it would
        # have 'entries' — noplaylist=True should prevent that, but guard anyway.
        if "entries" in info:
            info = info["entries"][0]

        # Sanity check: did we get a progressive stream the browser can play?
        # If yt-dlp couldn't satisfy our filter and fell back to something else,
        # we want to know about it loudly rather than silently failing later.
        protocol = info.get("protocol", "")
        ext = info.get("ext", "")
        acodec = info.get("acodec", "none")
        vcodec = info.get("vcodec", "none")

        if "m3u8" in protocol or "dash" in protocol:
            raise RuntimeError(
                f"yt-dlp returned an adaptive stream ({protocol}) which Chrome "
                f"cannot play natively. Format selector may need adjustment. "
                f"Video: {info.get('title', url)}"
            )
        if acodec == "none" or vcodec == "none":
            raise RuntimeError(
                f"yt-dlp returned a stream missing audio or video "
                f"(acodec={acodec}, vcodec={vcodec}). Need a progressive mp4."
            )

        stream_url = info.get("url")
        if not stream_url:
            raise RuntimeError(f"yt-dlp returned no usable stream URL for {url}")

        return {
            "stream_url": stream_url,
            "title": info.get("title") or "",
            "duration": info.get("duration") or 0,
            "video_id": info.get("id") or extract_video_id(url) or "",
            "ext": ext,
            "protocol": protocol,
            "format_id": info.get("format_id", ""),
            "resolved_at": time.time(),
        }

    async def resolve(self, url: str) -> dict:
        """Resolve a YouTube URL to a direct stream URL. Cached per video ID."""
        video_id = extract_video_id(url)
        if not video_id:
            raise ValueError(f"Not a recognizable YouTube URL: {url}")

        cached = self._cache_get(video_id)
        if cached:
            return cached

        # Coalesce concurrent requests for the same video
        if video_id in self._inflight:
            return await self._inflight[video_id]

        loop = asyncio.get_event_loop()
        future = loop.run_in_executor(None, self._resolve_sync, url)
        self._inflight[video_id] = future

        try:
            result = await future
            self._cache[video_id] = result
            return result
        finally:
            self._inflight.pop(video_id, None)

    def clear_cache(self):
        self._cache.clear()