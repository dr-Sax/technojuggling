"""
Frame processing thread - captures, tracks, and encodes frames
"""
import cv2
import time
import threading
from collections import deque
from config import *

class FrameProcessor:
    def __init__(self, camera, hand_tracker, ball_tracker):
        self.camera = camera
        self.hand_tracker = hand_tracker
        self.ball_tracker = ball_tracker
        
        # State
        self.latest_frame = None
        self.latest_encoded_frame = None
        self.latest_hand_data = self.hand_tracker._empty_hand_data()
        self.latest_ball_data = {'balls': []}
        
        # Performance tracking
        self.frame_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.encode_times = deque(maxlen=FRAME_BUFFER_SIZE)
        self.last_frame_time = time.time()
        self.frame_counter = 0
        
        # Thread control
        self.running = False
        self.thread = None
    
    def start(self):
        """Start frame processing thread"""
        self.running = True
        self.thread = threading.Thread(target=self._process_loop, daemon=True)
        self.thread.start()
        print("✓ Frame processor started")
    
    def stop(self):
        """Stop frame processing thread"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=1.0)
    
    def _process_loop(self):
        """Main processing loop"""
        while self.running:
            ret, frame = self.camera.read()
            if not ret:
                time.sleep(0.001)
                continue
            
            self.latest_frame = frame
            self.frame_counter += 1
            
            # Hand tracking (skip frames for performance)
            if HAND_TRACKING_ENABLED and self.frame_counter % HAND_TRACKING_SKIP == 0:
                self.latest_hand_data = self.hand_tracker.process(frame)
            
            # Ball tracking (every 3rd frame)
            if BALL_TRACKING_ENABLED and self.frame_counter % 3 == 0:
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
            
            time.sleep(0.001)
    
    def _encode_frame(self, frame):
        """Encode frame as JPEG"""
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        return buffer.tobytes()
    
    def get_latest_frame_data(self):
        """Get latest frame and tracking data"""
        return {
            'encoded_frame': self.latest_encoded_frame,
            'hands': self.latest_hand_data,
            'balls': self.latest_ball_data
        }
    
    def get_performance_stats(self):
        """Get performance statistics"""
        avg_frame_time = sum(self.frame_times) / len(self.frame_times) if self.frame_times else 0
        fps = 1.0 / avg_frame_time if avg_frame_time > 0 else 0
        avg_encode = sum(self.encode_times) / len(self.encode_times) if self.encode_times else 0
        
        hand_status = "✓" if (self.latest_hand_data['right_hand_detected'] or 
                              self.latest_hand_data['left_hand_detected']) else "✗"
        ball_count = len(self.latest_ball_data['balls'])
        
        return {
            'fps': fps,
            'encode_time': avg_encode,
            'hand_status': hand_status,
            'ball_count': ball_count
        }