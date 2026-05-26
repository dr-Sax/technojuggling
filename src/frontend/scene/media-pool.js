/**
 * Media Pool - Manages video and image elements for sequence playback.
 * Supports local files, direct web URLs, m3u8 streams, and YouTube URLs.
 *
 * YouTube URLs are resolved to direct stream URLs via the backend (yt-dlp).
 * Resolutions are cached per-session so hot-reloads don't re-resolve.
 *
 * Loaded clips are kept around across scene switches — SceneManager calls
 * removeMedia() only when a clip is removed from the config entirely.
 */
const RESOLVED_URL_TTL_MS = 4 * 60 * 60 * 1000;  // 4 hours, matches backend cache window
const RESOLVED_URL_STORAGE_KEY = 'mediaPool.resolvedUrls';

export class MediaPool {
    constructor(wsClient = null) {
        this.wsClient = wsClient;
        this.media = new Map();
        this.loadingPromises = new Map();
        this.resolvedUrlCache = this._loadResolvedUrlCache();
    }

    setWsClient(wsClient) {
        this.wsClient = wsClient;
    }

    isYouTubeUrl(url) {
        return typeof url === 'string' &&
            /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.test(url);
    }

    isGif(url) {
        return typeof url === 'string' && /\.gif(\?|#|$)/i.test(url);
    }

    getMediaType(url) {
        const lower = url.toLowerCase();
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m3u8'];
        if (imageExts.some(ext => lower.includes(ext))) return 'image';
        if (videoExts.some(ext => lower.includes(ext))) return 'video';
        // Default to video — m3u8, googlevideo, YouTube-resolved URLs etc.
        return 'video';
    }

    isLocalFile(url) {
        return !url.startsWith('http://') && !url.startsWith('https://');
    }

    /** Resolve a YouTube URL via the backend. Cached per session. */
    async resolveYouTubeUrl(url) {
        if (this.resolvedUrlCache.has(url)) {
            return this.resolvedUrlCache.get(url);
        }
        if (!this.wsClient) {
            throw new Error('MediaPool: wsClient required to resolve YouTube URLs');
        }
        console.log(`[MediaPool] Resolving YouTube URL: ${url}`);
        const result = await this.wsClient.request('resolve_url', { url });
        console.log(`[MediaPool]   -> "${result.title}" (${result.duration}s)`);
        this.resolvedUrlCache.set(url, result);
        this._saveResolvedUrlCache();
        return result;
    }

    /**
     * Load resolved-URL cache from localStorage, discarding any entries
     * older than RESOLVED_URL_TTL_MS. Returns a Map populated with the
     * still-fresh entries.
     */
    _loadResolvedUrlCache() {
        const cache = new Map();
        try {
            const raw = localStorage.getItem(RESOLVED_URL_STORAGE_KEY);
            if (!raw) return cache;

            const stored = JSON.parse(raw);
            const now = Date.now();
            let kept = 0, dropped = 0;

            for (const [url, entry] of Object.entries(stored)) {
                if (entry && entry.resolvedAt && (now - entry.resolvedAt) < RESOLVED_URL_TTL_MS) {
                    // Keep the original payload shape; resolvedAt is metadata only.
                    const { resolvedAt, ...payload } = entry;
                    cache.set(url, payload);
                    kept++;
                } else {
                    dropped++;
                }
            }

            if (kept > 0 || dropped > 0) {
                console.log(`[MediaPool] Loaded ${kept} cached YouTube resolutions (${dropped} expired)`);
            }
        } catch (e) {
            // Corrupt cache, quota exceeded, or localStorage unavailable — start fresh.
            console.warn('[MediaPool] Failed to load resolved-URL cache:', e);
        }
        return cache;
    }

    /**
     * Persist the current resolved-URL cache to localStorage, stamping
     * each entry with the current time so _loadResolvedUrlCache can expire it.
     */
    _saveResolvedUrlCache() {
        try {
            const now = Date.now();
            const toStore = {};
            for (const [url, payload] of this.resolvedUrlCache) {
                toStore[url] = { ...payload, resolvedAt: now };
            }
            localStorage.setItem(RESOLVED_URL_STORAGE_KEY, JSON.stringify(toStore));
        } catch (e) {
            // Quota exceeded or localStorage unavailable — non-fatal, in-memory cache still works.
            console.warn('[MediaPool] Failed to save resolved-URL cache:', e);
        }
    }

    /**
     * Get or create the master media element for a clip. Concurrent calls
     * for the same clipId share one in-flight promise so we never load twice.
     */
    async getMedia(clipId, url) {
        if (this.media.has(clipId)) return this.media.get(clipId);
        if (this.loadingPromises.has(clipId)) return this.loadingPromises.get(clipId);

        const loadPromise = this.loadMedia(clipId, url);
        this.loadingPromises.set(clipId, loadPromise);

        try {
            const media = await loadPromise;
            this.media.set(clipId, media);
            return media;
        } finally {
            this.loadingPromises.delete(clipId);
        }
    }

    /**
     * Assign a clip to a ball object. Each video ball gets its own cloned
     * element so balls can play the same clip independently. Images are
     * shared because they're stateless.
     */
    async assignClipToObject(objectId, clipId, url, videoStart = 0) {
        const master = await this.getMedia(clipId, url);

        if (master.type !== 'video') {
            return master;
        }

        const clone = master.element.cloneNode(false);
        clone.src = master.src;
        clone.crossOrigin = 'anonymous';
        clone.muted = true;
        clone.playsInline = true;

        await new Promise((resolve, reject) => {
            if (clone.readyState >= 2) {
                resolve();
            } else {
                clone.addEventListener('loadeddata', resolve, { once: true });
                clone.addEventListener('error', reject, { once: true });
                clone.load();
            }
        });

        if (videoStart > 0) {
            await new Promise(resolve => {
                const doSeek = () => { clone.currentTime = videoStart; resolve(); };
                if (clone.seekable && clone.seekable.length > 0) doSeek();
                else clone.addEventListener('canplay', doSeek, { once: true });
            });
        }

        return { element: clone, type: 'video', src: master.src };
    }

    /** Route to image or video creation, with local-path rewriting. */
    async loadMedia(clipId, url) {
        if (this.isYouTubeUrl(url)) {
            const resolved = await this.resolveYouTubeUrl(url);
            return this.createVideoElement(resolved.stream_url, clipId);
        }

        const mediaType = this.getMediaType(url);
        const mediaUrl = this.isLocalFile(url)
            ? (mediaType === 'image' ? `../../assets/images/${url}` : `../../assets/videos/${url}`)
            : url;

        return mediaType === 'image'
            ? this.createImageElement(mediaUrl, clipId)
            : this.createVideoElement(mediaUrl, clipId);
    }

    createVideoElement(url, clipId) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.loop = false;
            video.muted = true;
            video.playsInline = true;
            video.addEventListener('loadeddata', () => {
                resolve({ element: video, type: 'video', src: url });
            });
            video.addEventListener('error', () => {
                reject(new Error(`Failed to load video ${clipId}: ${url}`));
            });
            video.src = url;
            video.load();
        });
    }

    createImageElement(url, clipId) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.addEventListener('load', () => {
                resolve({ element: img, type: 'image', src: url, animated: this.isGif(url) });
            });
            img.addEventListener('error', () => {
                reject(new Error(`Failed to load image ${clipId}: ${url}`));
            });
            img.src = url;
        });
    }

    /** Remove a single clip from the pool (called by SceneManager._pruneMediaPool). */
    removeMedia(clipId) {
        const media = this.media.get(clipId);
        if (!media) return;
        if (media.type === 'video') {
            media.element.pause();
            media.element.src = '';
            media.element.load();
        }
        this.media.delete(clipId);
    }

    /** Clear everything (called only on shutdown, not on reload). */
    clear() {
        for (const media of this.media.values()) {
            if (media.type === 'video') {
                media.element.pause();
                media.element.src = '';
                media.element.load();
            }
        }
        this.media.clear();
        this.loadingPromises.clear();
    }
}