"""
Frame processing thread - Ball tracking only
OPTIMIZED FOR LOW LATENCY
"""
import cv2
import time
import threading
from collections import deque
from config import *
from encoder import create_encoder

class FrameProcessor:
    def __init__(self, camera, ball_tracker=None):
        self.camera = camera
        self.ball_tracker = ball_tracker
        
        # Initialize encoder
        camera_width, camera_height, camera_fps = camera.get_dimensions()
        self.encoder = create_encoder(
            width=camera_width,
            height=camera_height,
            fps=int(camera_fps)
        )
        
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
        
        print(f"Frame processor initialized (ball tracking only)")
    
    def start(self):
        """Start frame processing thread"""
        self.running = True
        self.thread = threading.Thread(target=self._process_loop, daemon=True)
        self.thread.start()
        print("Frame processor started")
    
    def stop(self):
        """Stop frame processing thread"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
        if self.encoder:
            self.encoder.release()
    
    def _process_loop(self):
        """Main processing loop - OPTIMIZED"""
        while self.running:
            ret, frame = self.camera.read()
            if not ret:
                time.sleep(0.001)
                continue
            
            self.latest_frame = frame
            self.frame_counter += 1
            self.frame_id += 1
            
            # Ball tracking - EVERY FRAME for low latency
            if self.ball_tracker:
                balls = self.ball_tracker.detect(frame)
                self.latest_ball_data = {'balls': balls}
            
            # Encode frame
            encode_start = time.time()
            encoded = self._encode_frame(frame)
            encode_time = (time.time() - encode_start) * 1000
            self.encode_times.append(encode_time)
            
            self.latest_encoded_frame = encoded
            
            # FPS calculation
            current_time = time.time()
            self.frame_times.append(current_time - self.last_frame_time)
            self.last_frame_time = current_time
    
    def _encode_frame(self, frame):
        """Encode frame using JPEG"""
        return self.encoder.encode(frame, JPEG_QUALITY)
    
    def get_latest_frame_data(self):
        """Get latest frame and tracking data with frame ID"""
        return {
            'encoded_frame': self.latest_encoded_frame,
            'balls': self.latest_ball_data,
            'frame_id': self.frame_id
        }
    
    def get_performance_stats(self):
        """Get performance statistics"""
        avg_frame_time = sum(self.frame_times) / len(self.frame_times) if self.frame_times else 0
        fps = 1.0 / avg_frame_time if avg_frame_time > 0 else 0
        avg_encode = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
        
        ball_count = len(self.latest_ball_data['balls'])
        
        return {
            'fps': fps,
            'encode_time': avg_encode,
            'ball_count': ball_count
        }