"""
Camera initialization and management
"""
import cv2
from config import *

class Camera:
    def __init__(self):
        self.camera = None
        self.actual_width = 0
        self.actual_height = 0
        self.actual_fps = 0
        
    def initialize(self):
        """Initialize camera with configured settings"""
        print("🎥 Initializing Camera...")
        
        self.camera = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)
        
        # Set camera properties
        self.camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
        self.camera.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
        self.camera.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
        self.camera.set(cv2.CAP_PROP_FPS, CAMERA_FPS)
        self.camera.set(cv2.CAP_PROP_BUFFERSIZE, CAMERA_BUFFER_SIZE)
        
        # Adjust lighting/exposure settings
        self.camera.set(cv2.CAP_PROP_BRIGHTNESS, CAMERA_BRIGHTNESS)
        self.camera.set(cv2.CAP_PROP_CONTRAST, CAMERA_CONTRAST)
        self.camera.set(cv2.CAP_PROP_SATURATION, CAMERA_SATURATION)
        self.camera.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
        
        # Verify actual settings
        self.actual_width = int(self.camera.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.actual_height = int(self.camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.actual_fps = self.camera.get(cv2.CAP_PROP_FPS)
        
        print(f"✓ Camera ready: {self.actual_width}x{self.actual_height} @ {self.actual_fps:.0f}fps")
        
        return self.camera
    
    def read(self):
        """Read frame from camera"""
        return self.camera.read()
    
    def release(self):
        """Release camera resources"""
        if self.camera:
            self.camera.release()
    
    def get_dimensions(self):
        """Get actual camera dimensions"""
        return self.actual_width, self.actual_height, self.actual_fps