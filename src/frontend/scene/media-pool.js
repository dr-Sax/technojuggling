/**
 * Media Pool - Manages video and image elements for sequence playback
 * Supports: local files, direct web URLs, and m3u8 streams
 */
export class MediaPool {
    constructor() {
        this.media = new Map(); // clipId -> { element, type: 'video'|'image' }
        this.loadingPromises = new Map();
        this.assignments = new Map();
    }

    /**
     * Detect media type from URL
     */
    getMediaType(url) {
        const lowerUrl = url.toLowerCase();
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
        const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m3u8'];
        
        if (imageExtensions.some(ext => lowerUrl.includes(ext))) {
            return 'image';
        }
        if (videoExtensions.some(ext => lowerUrl.includes(ext))) {
            return 'video';
        }
        // Default to video for URLs without clear extension (like m3u8 streams)
        return 'video';
    }

    /**
     * Check if URL is a local file path
     */
    isLocalFile(url) {
        return !url.startsWith('http://') && !url.startsWith('https://');
    }

    /**
     * Assign a clip to an object.
     * Each object gets its own video element (cloned from the pool's master copy)
     * so multiple balls can independently play the same clip.
     */
    async assignClipToObject(objectId, clipId, url, videoStart = 0) {
        try {
            const master = await this.getMedia(clipId, url);
            this.assignments.set(objectId, clipId);
            
            // Each object needs its own element for independent playback
            if (master.type === 'video') {
                const clone = master.element.cloneNode(false);
                clone.src = master.src;
                clone.crossOrigin = 'anonymous';
                clone.muted = true;
                clone.playsInline = true;
                
                // Wait for clone to be ready
                await new Promise((resolve, reject) => {
                    if (clone.readyState >= 2) {
                        resolve();
                    } else {
                        clone.addEventListener('loadeddata', resolve, { once: true });
                        clone.addEventListener('error', reject, { once: true });
                        clone.load();
                    }
                });

                // Seek to the clip's start time once the element is seekable
                if (videoStart > 0) {
                    await new Promise((resolve) => {
                        const doSeek = () => {
                            clone.currentTime = videoStart;
                            resolve();
                        };
                        if (clone.seekable && clone.seekable.length > 0) {
                            doSeek();
                        } else {
                            clone.addEventListener('canplay', doSeek, { once: true });
                        }
                    });
                }
                
                return { element: clone, type: 'video', src: master.src };
            }
            
            // Images can be safely shared (stateless)
            return master;
        } catch (error) {
            console.error(`[MediaPool] Failed to assign ${clipId} to ${objectId}:`, error);
            throw error;
        }
    }

    /**
     * Preload next clip in background
     */
    async preloadNext(objectId, nextClip) {
        if (!nextClip || !nextClip.url) return;
        
        const clipId = nextClip.clipName || nextClip.id;
        
        if (this.media.has(clipId) || this.loadingPromises.has(clipId)) {
            return;
        }
        
        this.getMedia(clipId, nextClip.url).catch(error => {
            console.warn(`[MediaPool] Failed to preload ${clipId}:`, error);
        });
    }

    /**
     * Get current assignment for an object
     */
    getAssignment(objectId) {
        return this.assignments.get(objectId);
    }

    /**
     * Clear assignment for an object
     */
    clearAssignment(objectId) {
        this.assignments.delete(objectId);
    }

    /**
     * Get or create a media element for a clip
     */
    async getMedia(clipId, url) {
        if (this.media.has(clipId)) {
            return this.media.get(clipId);
        }

        if (this.loadingPromises.has(clipId)) {
            return this.loadingPromises.get(clipId);
        }

        const loadPromise = this.loadMedia(clipId, url);
        this.loadingPromises.set(clipId, loadPromise);

        try {
            const media = await loadPromise;
            this.media.set(clipId, media);
            this.loadingPromises.delete(clipId);
            return media;
        } catch (error) {
            this.loadingPromises.delete(clipId);
            throw error;
        }
    }

    /**
     * Load media — handles local files and direct web URLs
     */
    async loadMedia(clipId, url) {
        const mediaType = this.getMediaType(url);
        let mediaUrl;

        if (this.isLocalFile(url)) {
            mediaUrl = mediaType === 'image'
                ? `../../assets/images/${url}`
                : `../../assets/videos/${url}`;
        } else {
            mediaUrl = url;
        }

        return mediaType === 'image'
            ? this.createImageElement(mediaUrl, clipId)
            : this.createVideoElement(mediaUrl, clipId);
    }

    /**
     * Create and configure video element
     */
    createVideoElement(url, clipId) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.loop = false;
            video.muted = true;
            video.playsInline = true;

            video.addEventListener('loadeddata', () => {
                resolve({
                    element: video,
                    type: 'video',
                    src: url
                });
            });

            video.addEventListener('error', (e) => {
                console.error(`[MediaPool] Video load error for ${clipId}:`, e);
                reject(new Error(`Failed to load video: ${url}`));
            });

            video.src = url;
            video.load();
        });
    }

    /**
     * Create and configure image element
     */
    createImageElement(url, clipId) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.addEventListener('load', () => {
                resolve({
                    element: img,
                    type: 'image',
                    src: url
                });
            });

            img.addEventListener('error', (e) => {
                console.error(`[MediaPool] Image load error for ${clipId}:`, e);
                reject(new Error(`Failed to load image: ${url}`));
            });

            img.src = url;
        });
    }

    /**
     * Preload media for smooth playback
     */
    async preloadClips(clips) {
        const preloadPromises = clips.map(async ({ id, url }) => {
            if (!this.media.has(id) && !this.loadingPromises.has(id)) {
                try {
                    await this.getMedia(id, url);
                } catch (error) {
                    console.warn(`[MediaPool] Failed to preload ${id}:`, error);
                }
            }
        });

        await Promise.allSettled(preloadPromises);
    }

    /**
     * Get current media status
     */
    getStatus(clipId) {
        if (this.media.has(clipId)) {
            const media = this.media.get(clipId);
            return {
                loaded: true,
                type: media.type,
                duration: media.type === 'video' ? media.element.duration : null
            };
        }
        if (this.loadingPromises.has(clipId)) {
            return { loaded: false, loading: true };
        }
        return { loaded: false, loading: false };
    }

    /**
     * Remove media element
     */
    removeMedia(clipId) {
        const media = this.media.get(clipId);
        if (media) {
            if (media.type === 'video') {
                media.element.pause();
                media.element.src = '';
                media.element.load();
            }
            this.media.delete(clipId);
        }
    }

    /**
     * Clear all media
     */
    clear() {
        for (const [clipId, media] of this.media.entries()) {
            if (media.type === 'video') {
                media.element.pause();
                media.element.src = '';
                media.element.load();
            }
        }
        this.media.clear();
        this.loadingPromises.clear();
        this.assignments.clear();
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            loaded: this.media.size,
            loading: this.loadingPromises.size,
            assignments: this.assignments.size
        };
    }
}