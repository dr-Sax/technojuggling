"""
Ball tracking using OpenCV color detection
"""
import cv2
import numpy as np
from config import *
from startup_calibration import run_startup_calibration

class BallTracker:
    def __init__(self, camera):
        self.camera = camera
        self.enabled = BALL_TRACKING_ENABLED
        self.num_balls = NUM_BALLS
        self.hsv_mins = []
        self.hsv_maxs = []
        self.calibration_settings = {}
        
    def initialize(self):
        """Initialize ball tracking with calibration"""
        if not self.enabled:
            print("⚠️  Ball tracking disabled")
            self.num_balls = 0
            return {'camera_settings': {}, 'hsv_ranges': {}}
        
        print(f"🎨 Calibrating {self.num_balls} balls...")
        
        self.calibration_settings = run_startup_calibration(self.camera, num_balls=self.num_balls)
        
        if not self.calibration_settings:
            print("⚠️  Calibration skipped - ball tracking disabled")
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
        
        print(f"✓ Ball tracking enabled for {self.num_balls} balls")
        return self.calibration_settings
    
    def detect(self, frame):
        """Detect balls in frame"""
        if not self.enabled or self.num_balls == 0:
            return []
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        h, w = frame.shape[:2]
        detected = []
        
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
                    detected.append({
                        'id': i,
                        'x': x / w,
                        'y': y / h,
                        'radius': int(r)
                    })
        
        return detected
    
    def get_calibration_settings(self):
        """Get calibration settings for client"""
        return self.calibration_settings