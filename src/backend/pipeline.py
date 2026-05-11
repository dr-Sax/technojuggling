"""
Frame Pipeline - Camera capture, JPEG encoding, and ball tracking in one loop.
"""
import cv2
import time
import threading
from collections import deque
from config import *


class Camera:
    """Camera initialization with MJPEG forcing for target FPS.
    
    Args:
        index: Camera device index
        width: Desired width
        height: Desired height
        fps: Desired FPS
        resolution_attempts: List of (w, h) tuples to try
        brightness, contrast, saturation, exposure: Camera image settings
        label: Human-readable name for logging
    """
    
    def __init__(self, index=None, width=None, height=None, fps=None,
                 resolution_attempts=None, brightness=150, contrast=140,
                 saturation=140, exposure=-5, label="Camera"):
        self.device = None
        self.width = 0
        self.height = 0
        self.fps = 0
        self.label = label
        
        # Store settings
        self._index = index if index is not None else CAMERA_INDEX
        self._target_width = width if width is not None else CAMERA_WIDTH
        self._target_height = height if height is not None else CAMERA_HEIGHT
        self._target_fps = fps if fps is not None else CAMERA_FPS
        self._resolution_attempts = resolution_attempts if resolution_attempts is not None else RESOLUTION_ATTEMPTS
        self._brightness = brightness
        self._contrast = contrast
        self._saturation = saturation
        self._exposure = exposure
    
    def initialize(self):
        backends = [
            (cv2.CAP_DSHOW, "DSHOW"),
            (cv2.CAP_MSMF, "MSMF"),
        ]
        
        for backend, name in backends:
            for width, height in self._resolution_attempts:
                print(f"  [{self.label}] Trying {name} @ {width}x{height} (MJPEG forced)...")
                cap, w, h, fps, fourcc = self._try_setup(backend, width, height, self._target_fps)
                print(f"    Got: {w}x{h} @ {fps:.0f}fps [{fourcc}]")
                
                if fps >= self._target_fps - 5:
                    self.device, self.width, self.height, self.fps = cap, w, h, fps
                    print(f"  [{self.label}] SUCCESS: {w}x{h} @ {fps:.0f}fps ({name}, {fourcc})")
                    return
                else:
                    print(f"    Only {fps:.0f}fps, trying next...")
                    cap.release()
        
        # Fallback
        print(f"  [{self.label}] Warning: Could not achieve target FPS, using fallback...")
        cap, self.width, self.height, self.fps, fourcc = self._try_setup(
            cv2.CAP_DSHOW, self._target_width, self._target_height, self._target_fps
        )
        self.device = cap
        print(f"  [{self.label}] Ready: {self.width}x{self.height} @ {self.fps:.0f}fps ({fourcc}, fallback)")
    
    def _try_setup(self, backend, width, height, fps):
        cap = cv2.VideoCapture(self._index, backend)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        cap.set(cv2.CAP_PROP_FPS, fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, CAMERA_BUFFER_SIZE)
        cap.set(cv2.CAP_PROP_BRIGHTNESS, self._brightness)
        cap.set(cv2.CAP_PROP_CONTRAST, self._contrast)
        cap.set(cv2.CAP_PROP_SATURATION, self._saturation)
        cap.set(cv2.CAP_PROP_EXPOSURE, self._exposure)
        
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = cap.get(cv2.CAP_PROP_FPS)
        raw_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
        fourcc_str = "".join([chr((raw_fourcc >> 8 * i) & 0xFF) for i in range(4)])
        
        return cap, w, h, actual_fps, fourcc_str
    
    def read(self):
        return self.device.read()
    
    def release(self):
        if self.device:
            self.device.release()
    
    def get_dimensions(self):
        return self.width, self.height, self.fps


class FramePipeline:
    """
    Single-camera processing loop.
    Read frame → detect balls → encode JPEG → store latest.
    """
    
    def __init__(self, camera, ball_tracker=None):
        self.camera = camera
        self.ball_tracker = ball_tracker
        
        # State
        self.latest_frame = None
        self.latest_encoded_frame = None
        self.latest_ball_data = {'balls': []}
        self.frame_id = 0
        
        # Performance tracking
        self.frame_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.encode_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.last_frame_time = time.time()
        self.frame_counter = 0
        
        # Encoding target dimensions
        self.encode_width = CAMERA_WIDTH
        self.encode_height = CAMERA_HEIGHT
        
        # Thread control
        self.running = False
        self.thread = None
    
    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        print("Frame pipeline started")
    
    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
    
    def _loop(self):
        while self.running:
            ret, frame = self.camera.read()
            if not ret:
                time.sleep(0.001)
                continue
            
            self.latest_frame = frame
            self.frame_counter += 1
            self.frame_id += 1
            
            if self.ball_tracker:
                balls = self.ball_tracker.detect(frame)
                self.latest_ball_data = {'balls': balls}
            
            h_actual, w_actual = frame.shape[:2]
            if w_actual != self.encode_width or h_actual != self.encode_height:
                encode_frame = cv2.resize(
                    frame,
                    (self.encode_width, self.encode_height),
                    interpolation=cv2.INTER_LINEAR
                )
            else:
                encode_frame = frame

            encode_start = time.time()
            _, buffer = cv2.imencode('.jpg', encode_frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            self.latest_encoded_frame = buffer.tobytes()
            self.encode_times.append((time.time() - encode_start) * 1000)
            
            now = time.time()
            self.frame_times.append(now - self.last_frame_time)
            self.last_frame_time = now
    
    def get_latest_frame_data(self):
        return {
            'encoded_frame': self.latest_encoded_frame,
            'balls': self.latest_ball_data,
            'frame_id': self.frame_id
        }
    
    def get_performance_stats(self):
        avg_frame_time = sum(self.frame_times) / len(self.frame_times) if self.frame_times else 0
        fps = 1.0 / avg_frame_time if avg_frame_time > 0 else 0
        avg_encode = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
        
        return {
            'fps': fps,
            'encode_time': avg_encode,
            'ball_count': len(self.latest_ball_data['balls'])
        }