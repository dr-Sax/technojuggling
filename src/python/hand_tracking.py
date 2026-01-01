"""
Hand tracking using MediaPipe Tasks API (v0.10.31+)
"""
import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from config import *

class HandTracker:
    def __init__(self):
        self.detector = None
        self.enabled = HAND_TRACKING_ENABLED
        
    def initialize(self):
        """Initialize MediaPipe hand landmarker with new Tasks API"""
        if not self.enabled:
            print("Hand tracking disabled")
            return
        
        print("Initializing MediaPipe hand tracking (Tasks API)...")
        
        # Download hand landmarker model if not present
        import os
        import urllib.request
        
        model_path = "hand_landmarker.task"
        if not os.path.exists(model_path):
            print("Downloading hand landmarker model...")
            model_url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            urllib.request.urlretrieve(model_url, model_path)
            print("Model downloaded")
        
        # Create HandLandmarker options
        base_options = python.BaseOptions(
            model_asset_path=model_path,
            delegate=python.BaseOptions.Delegate.GPU  # Try GPU acceleration
        )
        
        options = vision.HandLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO,  # Video mode for live camera
            num_hands=MAX_NUM_HANDS,
            min_hand_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_hand_presence_confidence=MIN_TRACKING_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE
        )
        
        # Create the hand landmarker
        self.detector = vision.HandLandmarker.create_from_options(options)
        
        print("MediaPipe ready (GPU acceleration enabled if available)")
    
    def process(self, frame):
        """Process frame and return hand tracking data"""
        if not self.enabled or not self.detector:
            return self._empty_hand_data()
        
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Create MediaPipe Image
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        
        # Detect hands (timestamp in milliseconds)
        import time
        timestamp_ms = int(time.time() * 1000)
        detection_result = self.detector.detect_for_video(mp_image, timestamp_ms)
        
        # Parse results
        right = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        left = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        
        if detection_result.hand_landmarks:
            for idx, hand_landmarks in enumerate(detection_result.hand_landmarks):
                # Get handedness (left or right)
                handedness = detection_result.handedness[idx][0]
                is_right = handedness.category_name == "Right"
                
                # Convert landmarks to list format
                landmarks = []
                for landmark in hand_landmarks:
                    landmarks.append({
                        'x': landmark.x,
                        'y': landmark.y,
                        'z': landmark.z
                    })
                
                # Calculate center position (average of all landmarks)
                avg_x = sum(lm['x'] for lm in landmarks) / len(landmarks)
                avg_y = sum(lm['y'] for lm in landmarks) / len(landmarks)
                avg_z = sum(lm['z'] for lm in landmarks) / len(landmarks)
                
                hand_data = {
                    'detected': True,
                    'position': {'x': avg_x, 'y': avg_y, 'z': avg_z},
                    'landmarks': landmarks
                }
                
                if is_right:
                    right = hand_data
                else:
                    left = hand_data
        
        return {'right': right, 'left': left}
    
    def _empty_hand_data(self):
        """Return empty hand data structure"""
        return {
            'right': {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []},
            'left': {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        }
    
    def release(self):
        """Release MediaPipe resources"""
        if self.detector:
            self.detector.close()
            self.detector = None