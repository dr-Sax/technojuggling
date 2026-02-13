"""
Frame Pipeline - Camera capture, JPEG encoding, and ball tracking in one loop.
Merges the former camera.py, encoder.py, and frame_processor.py.
"""
import cv2
import time
import threading
from collections import deque
from config import *


class Camera:
    """Camera initialization with MJPEG forcing for target FPS."""
    
    def __init__(self):
        self.device = None
        self.width = 0
        self.height = 0
        self.fps = 0
    
    def initialize(self):
        backends = [
            (cv2.CAP_DSHOW, "DSHOW"),
            (cv2.CAP_MSMF, "MSMF"),
        ]
        
        for backend, name in backends:
            for width, height in RESOLUTION_ATTEMPTS:
                print(f"  Trying {name} @ {width}x{height} (MJPEG forced)...")
                cap, w, h, fps, fourcc = self._try_setup(backend, width, height, CAMERA_FPS)
                print(f"    Got: {w}x{h} @ {fps:.0f}fps [{fourcc}]")
                
                if fps >= CAMERA_FPS - 5:
                    self.device, self.width, self.height, self.fps = cap, w, h, fps
                    print(f"SUCCESS: Camera ready: {w}x{h} @ {fps:.0f}fps ({name}, {fourcc})")
                    return
                else:
                    print(f"    Only {fps:.0f}fps, trying next...")
                    cap.release()
        
        # Fallback
        print("  Warning: Could not achieve target FPS, using fallback...")
        cap, self.width, self.height, self.fps, fourcc = self._try_setup(
            cv2.CAP_DSHOW, CAMERA_WIDTH, CAMERA_HEIGHT, CAMERA_FPS
        )
        self.device = cap
        print(f"Camera ready: {self.width}x{self.height} @ {self.fps:.0f}fps ({fourcc}, fallback)")
    
    def _try_setup(self, backend, width, height, fps):
        cap = cv2.VideoCapture(CAMERA_INDEX, backend)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        cap.set(cv2.CAP_PROP_FPS, fps)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, CAMERA_BUFFER_SIZE)
        cap.set(cv2.CAP_PROP_BRIGHTNESS, CAMERA_BRIGHTNESS)
        cap.set(cv2.CAP_PROP_CONTRAST, CAMERA_CONTRAST)
        cap.set(cv2.CAP_PROP_SATURATION, CAMERA_SATURATION)
        cap.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
        
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
    Single processing loop: read frame → detect balls → encode JPEG → store latest.
    Runs in a background thread.
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
            # 1. Read frame
            ret, frame = self.camera.read()
            if not ret:
                time.sleep(0.001)
                continue
            
            self.latest_frame = frame
            self.frame_counter += 1
            self.frame_id += 1
            
            # 2. Detect balls
            if self.ball_tracker:
                balls = self.ball_tracker.detect(frame)
                self.latest_ball_data = {'balls': balls}
            
            # 3. Encode JPEG
            encode_start = time.time()
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            self.latest_encoded_frame = buffer.tobytes()
            self.encode_times.append((time.time() - encode_start) * 1000)
            
            # FPS tracking
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