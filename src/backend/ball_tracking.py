"""
Ball tracking using OpenCV color detection with optional optical flow
"""
import cv2
import numpy as np
from config import *
from startup_calibration_async import run_async_calibration

class BallTracker:
    def __init__(self, camera):
        self.camera = camera
        self.enabled = TRACKING_MODE in ["balls", "both"]
        self.num_balls = NUM_BALLS if self.enabled else 0
        self.hsv_mins = []
        self.hsv_maxs = []
        self.calibration_settings = {}
        
        # Optical flow tracking
        self.use_optical_flow = USE_OPTICAL_FLOW and self.enabled
        self.prev_gray = None
        self.prev_positions = {}  # {ball_id: (x, y)}
        
        # Optical flow parameters
        self.lk_params = dict(
            winSize=(15, 15),
            maxLevel=2,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
        )
        
    async def initialize(self):
        """Initialize ball tracking with async calibration"""
        if not self.enabled:
            print("Ball tracking disabled")
            return {'camera_settings': {}, 'hsv_ranges': {}}
        
        print(f"Calibrating {self.num_balls} balls...")
        
        # Use async calibration (user-triggered from frontend)
        self.calibration_settings = await run_async_calibration(self.camera, num_balls=self.num_balls)
        
        if not self.calibration_settings:
            print("Calibration skipped - ball tracking disabled")
            self.num_balls = 0
            self.enabled = False
            return {'camera_settings': {}, 'hsv_ranges': {}}
        
        # Extract HSV ranges
        hsv_ranges = self.calibration_settings['hsv_ranges']
        self.hsv_mins = [
            np.array([hsv_ranges[i]['h_min'], hsv_ranges[i]['s_min'], hsv_ranges[i]['v_min']]) 
            for i in range(self.num_balls)
        ]
        self.hsv_maxs = [
            np.array([hsv_ranges[i]['h_max'], hsv_ranges[i]['s_max'], hsv_ranges[i]['v_max']]) 
            for i in range(self.num_balls)
        ]
        
        status = f"Ball tracking enabled for {self.num_balls} balls"
        if self.use_optical_flow:
            status += " (with optical flow)"
        print(status)
        
        return self.calibration_settings
    
    def detect(self, frame):
        """Detect balls in frame with optional optical flow velocity"""
        if not self.enabled or self.num_balls == 0:
            return []
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        h, w = frame.shape[:2]
        detected = []
        
        # Optical flow setup
        if self.use_optical_flow:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        for i in range(self.num_balls):
            mask = cv2.inRange(hsv, self.hsv_mins[i], self.hsv_maxs[i])
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5,5), np.uint8))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5,5), np.uint8))
            
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest)
                (x, y), r = cv2.minEnclosingCircle(largest)
                
                if area > MIN_BALL_AREA and MIN_BALL_RADIUS < r < MAX_BALL_RADIUS:
                    ball_data = {
                        'id': i,
                        'x': x / w,
                        'y': y / h,
                        'radius': int(r)
                    }
                    
                    # Add velocity if optical flow enabled
                    if self.use_optical_flow:
                        vx, vy = self._calculate_velocity(i, x, y, gray)
                        ball_data['vx'] = vx
                        ball_data['vy'] = vy
                    
                    detected.append(ball_data)
        
        # Update previous frame for optical flow
        if self.use_optical_flow:
            self.prev_gray = gray
            self.prev_positions = {b['id']: (b['x'] * w, b['y'] * h) for b in detected}
        
        return detected
    
    def _calculate_velocity(self, ball_id, x, y, gray):
        """Calculate velocity using optical flow"""
        if self.prev_gray is None or ball_id not in self.prev_positions:
            return 0.0, 0.0
        
        prev_x, prev_y = self.prev_positions[ball_id]
        
        # Simple velocity: current - previous position
        # Normalized to [-1, 1] range based on frame dimensions
        h, w = gray.shape
        vx = (x - prev_x) / w
        vy = (y - prev_y) / h
        
        return float(vx), float(vy)
    
    def get_calibration_settings(self):
        """Get calibration settings for client"""
        return self.calibration_settings