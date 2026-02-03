"""
Frame processing thread - captures, tracks, and encodes frames
OPTIMIZED FOR LOW LATENCY
"""
import cv2
import time
import threading
from collections import deque
from config import *
from encoder import create_encoder

class FrameProcessor:
    def __init__(self, camera, hand_tracker=None, ball_tracker=None):
        self.camera = camera
        self.hand_tracker = hand_tracker
        self.ball_tracker = ball_tracker
        
        # Check which trackers are active
        self.hand_tracking_enabled = hand_tracker is not None and hand_tracker.enabled
        self.ball_tracking_enabled = ball_tracker is not None and ball_tracker.enabled
        
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
        self.latest_hand_data = self._empty_hand_data()
        self.latest_ball_data = {'balls': []}
        self.frame_id = 0  # Track unique frames
        
        # Performance tracking
        self.frame_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.encode_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.last_frame_time = time.time()
        self.frame_counter = 0
        
        # Thread control
        self.running = False
        self.thread = None
        
        print(f"Frame processor initialized:")
        print(f"  Hand tracking: {'Enabled' if self.hand_tracking_enabled else 'Disabled'}")
        print(f"  Ball tracking: {'Enabled' if self.ball_tracking_enabled else 'Disabled'}")
    
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
            self.frame_id += 1  # Increment unique frame ID
            
            # Hand tracking (skip frames for performance if needed)
            if self.hand_tracking_enabled and self.frame_counter % HAND_TRACKING_SKIP == 0:
                self.latest_hand_data = self.hand_tracker.process(frame)
            
            # Ball tracking - EVERY FRAME for low latency
            if self.ball_tracking_enabled:
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
            
            # No sleep - process frames as fast as camera delivers them
    
    def _encode_frame(self, frame):
        """Encode frame using NVENC or JPEG"""
        return self.encoder.encode(frame, JPEG_QUALITY)
    
    def _empty_hand_data(self):
        """Return empty hand data structure"""
        return {
            'right': {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []},
            'left': {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        }
    
    def get_latest_frame_data(self):
        """Get latest frame and tracking data with frame ID"""
        return {
            'encoded_frame': self.latest_encoded_frame,
            'hands': self.latest_hand_data,
            'balls': self.latest_ball_data,
            'frame_id': self.frame_id  # Add frame ID to detect duplicates
        }
    
    def get_performance_stats(self):
        """Get performance statistics"""
        avg_frame_time = sum(self.frame_times) / len(self.frame_times) if self.frame_times else 0
        fps = 1.0 / avg_frame_time if avg_frame_time > 0 else 0
        avg_encode = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
        
        hand_status = "Y" if (self.latest_hand_data.get('right', {}).get('detected', False) or 
                              self.latest_hand_data.get('left', {}).get('detected', False)) else "N"
        ball_count = len(self.latest_ball_data['balls'])
        
        return {
            'fps': fps,
            'encode_time': avg_encode,
            'hand_status': hand_status,
            'ball_count': ball_count
        }