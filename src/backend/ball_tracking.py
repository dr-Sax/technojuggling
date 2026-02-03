"""
Ball tracking using OpenCV color detection - OPTIMIZED FOR SPEED
With Kalman filtering for smooth prediction
"""
import cv2
import numpy as np
from config import *
from startup_calibration_async import run_async_calibration

class KalmanBallTracker:
    """Simple Kalman filter for tracking ball position and velocity"""
    def __init__(self):
        # State: [x, y, vx, vy] - position and velocity
        self.kf = cv2.KalmanFilter(4, 2)  # 4 state vars, 2 measurements (x, y)
        
        # Transition matrix (constant velocity model)
        dt = 1.0 / 30.0  # Assume 30fps
        self.kf.transitionMatrix = np.array([
            [1, 0, dt, 0],
            [0, 1, 0, dt],
            [0, 0, 1, 0],
            [0, 0, 0, 1]
        ], dtype=np.float32)
        
        # Measurement matrix (we only measure x, y)
        self.kf.measurementMatrix = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0]
        ], dtype=np.float32)
        
        # Process noise (how much we trust the model)
        self.kf.processNoiseCov = np.eye(4, dtype=np.float32) * 0.03
        
        # Measurement noise (how much we trust the measurements)
        self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 0.1
        
        self.last_measurement = None
        self.frames_since_detection = 0
        self.max_prediction_frames = 5  # Predict for max 5 frames without detection
        
    def update(self, x, y):
        """Update with new measurement"""
        measurement = np.array([[x], [y]], dtype=np.float32)
        self.kf.correct(measurement)
        self.last_measurement = (x, y)
        self.frames_since_detection = 0
        
    def predict(self):
        """Predict next position"""
        prediction = self.kf.predict()
        return float(prediction[0]), float(prediction[1]), float(prediction[2]), float(prediction[3])
        
    def get_predicted_position(self):
        """Get predicted position when no detection"""
        self.frames_since_detection += 1
        if self.frames_since_detection > self.max_prediction_frames:
            return None  # Lost track
        x, y, vx, vy = self.predict()
        return x, y, vx, vy

class BallTracker:
    def __init__(self, camera):
        self.camera = camera
        self.enabled = TRACKING_MODE in ["balls", "both"]
        self.num_balls = NUM_BALLS if self.enabled else 0
        self.hsv_mins = []
        self.hsv_maxs = []
        self.calibration_settings = {}
        
        # Kalman filters for each ball
        self.kalman_trackers = {}  # {ball_id: KalmanBallTracker}
        
        # OPTIMIZATION: Pre-create morphology kernels
        self.morph_kernel = np.ones((5, 5), np.uint8)
        
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
        
        print(f"Ball tracking enabled for {self.num_balls} balls")
        
        return self.calibration_settings
    
    def detect(self, frame):
        """Detect balls in frame - OPTIMIZED FOR SPEED with Kalman prediction"""
        if not self.enabled or self.num_balls == 0:
            return []
        
        # OPTIMIZATION 1: Resize frame for faster processing
        # Process at half resolution, then scale coordinates back up
        small_frame = cv2.resize(frame, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_LINEAR)
        
        hsv = cv2.cvtColor(small_frame, cv2.COLOR_BGR2HSV)
        h, w = small_frame.shape[:2]
        detected = []
        detected_ids = set()
        
        for i in range(self.num_balls):
            # OPTIMIZATION 2: Simpler morphology - just one close operation
            mask = cv2.inRange(hsv, self.hsv_mins[i], self.hsv_maxs[i])
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self.morph_kernel)
            
            # OPTIMIZATION 3: Use CHAIN_APPROX_SIMPLE for faster contour detection
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if contours:
                # Find largest contour
                largest = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest)
                
                # Adjust thresholds for half-resolution
                min_area = MIN_BALL_AREA / 4  # Area scales by 0.5^2 = 0.25
                min_r = MIN_BALL_RADIUS / 2
                max_r = MAX_BALL_RADIUS / 2
                
                if area > min_area:
                    (x, y), r = cv2.minEnclosingCircle(largest)
                    
                    if min_r < r < max_r:
                        # Normalize coordinates to [0, 1]
                        norm_x = (x * 2) / (w * 2)
                        norm_y = (y * 2) / (h * 2)
                        
                        # Initialize Kalman tracker if needed
                        if i not in self.kalman_trackers:
                            self.kalman_trackers[i] = KalmanBallTracker()
                            self.kalman_trackers[i].kf.statePost = np.array([
                                [norm_x], [norm_y], [0], [0]
                            ], dtype=np.float32)
                        
                        # Update Kalman filter with detection
                        self.kalman_trackers[i].update(norm_x, norm_y)
                        
                        # Get predicted state (smoothed position + velocity)
                        pred_x, pred_y, vx, vy = self.kalman_trackers[i].predict()
                        
                        ball_data = {
                            'id': i,
                            'x': pred_x,  # Use Kalman prediction (smoother)
                            'y': pred_y,
                            'radius': int(r * 2),
                            'vx': vx,  # Velocity from Kalman filter
                            'vy': vy
                        }
                        
                        detected.append(ball_data)
                        detected_ids.add(i)
        
        # For balls not detected, use Kalman prediction
        for i in range(self.num_balls):
            if i not in detected_ids and i in self.kalman_trackers:
                prediction = self.kalman_trackers[i].get_predicted_position()
                if prediction is not None:
                    pred_x, pred_y, vx, vy = prediction
                    
                    # Only include prediction if within bounds
                    if 0 <= pred_x <= 1 and 0 <= pred_y <= 1:
                        ball_data = {
                            'id': i,
                            'x': pred_x,
                            'y': pred_y,
                            'radius': 20,  # Estimated radius
                            'vx': vx,
                            'vy': vy,
                            'predicted': True  # Flag for frontend
                        }
                        detected.append(ball_data)
        
        return detected
    
    def get_calibration_settings(self):
        """Get calibration settings for client"""
        return self.calibration_settings