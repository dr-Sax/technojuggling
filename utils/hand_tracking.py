"""
Hand tracking using MediaPipe
"""
import cv2
import mediapipe as mp
from config import *

class HandTracker:
    def __init__(self):
        self.mp_hands = mp.solutions.hands
        self.hands = None
        self.enabled = HAND_TRACKING_ENABLED
        
    def initialize(self):
        """Initialize MediaPipe hands"""
        if not self.enabled:
            print("⚠️  Hand tracking disabled")
            return
        
        print("🖐️  Initializing MediaPipe hand tracking...")
        
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=MAX_NUM_HANDS,
            min_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
            model_complexity=HAND_MODEL_COMPLEXITY
        )
        
        print("✓ MediaPipe ready")
    
    def process(self, frame):
        """Process frame and return hand tracking data"""
        if not self.enabled or not self.hands:
            return self._empty_hand_data()
        
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(frame_rgb)
        
        right = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        left = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        
        if results.multi_hand_landmarks and results.multi_handedness:
            for hand_lm, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
                landmarks = [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in hand_lm.landmark]
                
                # Calculate center
                xs = [lm['x'] for lm in landmarks]
                ys = [lm['y'] for lm in landmarks]
                zs = [lm['z'] for lm in landmarks]
                center = {
                    'x': sum(xs) / len(xs),
                    'y': sum(ys) / len(ys),
                    'z': sum(zs) / len(zs)
                }
                
                data = {'detected': True, 'position': center, 'landmarks': landmarks}
                
                if handedness.classification[0].label == 'Right':
                    right = data
                else:
                    left = data
        
        return {
            'right_hand_detected': right['detected'],
            'right_hand_position': right['position'],
            'right_hand_landmarks': right['landmarks'],
            'left_hand_detected': left['detected'],
            'left_hand_position': left['position'],
            'left_hand_landmarks': left['landmarks']
        }
    
    def _empty_hand_data(self):
        """Return empty hand data structure"""
        return {
            'right_hand_detected': False,
            'right_hand_position': {'x': 0, 'y': 0, 'z': 0},
            'right_hand_landmarks': [],
            'left_hand_detected': False,
            'left_hand_position': {'x': 0, 'y': 0, 'z': 0},
            'left_hand_landmarks': []
        }
    
    def release(self):
        """Release MediaPipe resources"""
        if self.hands:
            self.hands.close()