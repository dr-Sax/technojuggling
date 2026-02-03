"""
Camera initialization and management with aggressive MJPEG forcing for 60fps
"""
import cv2
from config import *

class Camera:
    def __init__(self):
        self.camera = None
        self.actual_width = 0
        self.actual_height = 0
        self.actual_fps = 0
        
    def _try_camera_setup(self, backend, width, height, fps):
        """Try to initialize camera with MJPEG forced FIRST"""
        cap = cv2.VideoCapture(CAMERA_INDEX, backend)
        
        # CRITICAL: Set MJPEG BEFORE resolution/fps
        # This prevents fallback to uncompressed YUY2/NV12
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
        
        # Now set resolution and FPS
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        cap.set(cv2.CAP_PROP_FPS, fps)
        
        # Set buffer size
        cap.set(cv2.CAP_PROP_BUFFERSIZE, CAMERA_BUFFER_SIZE)
        
        # Adjust lighting/exposure settings
        cap.set(cv2.CAP_PROP_BRIGHTNESS, CAMERA_BRIGHTNESS)
        cap.set(cv2.CAP_PROP_CONTRAST, CAMERA_CONTRAST)
        cap.set(cv2.CAP_PROP_SATURATION, CAMERA_SATURATION)
        cap.set(cv2.CAP_PROP_EXPOSURE, CAMERA_EXPOSURE)
        
        # Check what we actually got
        actual_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = cap.get(cv2.CAP_PROP_FPS)
        actual_fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
        
        # Decode fourcc to verify MJPEG
        fourcc_str = "".join([chr((actual_fourcc >> 8 * i) & 0xFF) for i in range(4)])
        
        return cap, actual_width, actual_height, actual_fps, fourcc_str
        
    def initialize(self):
        """Initialize camera with smart fallback for 60fps, MJPEG forced"""
        print("Initializing Camera...")
        
        # Try DSHOW first (works better with Brio)
        backends_to_try = [
            (cv2.CAP_DSHOW, "DSHOW"),
            (cv2.CAP_MSMF, "MSMF"),
        ]
        
        # Try each backend with each resolution
        for backend, backend_name in backends_to_try:
            for width, height in RESOLUTION_ATTEMPTS:
                print(f"  Trying {backend_name} @ {width}x{height} (MJPEG forced)...")
                
                cap, actual_width, actual_height, actual_fps, fourcc = self._try_camera_setup(
                    backend, width, height, CAMERA_FPS
                )
                
                print(f"    Got: {actual_width}x{actual_height} @ {actual_fps:.0f}fps [{fourcc}]")
                
                # Check if we got target FPS (allow 5fps tolerance)
                if actual_fps >= CAMERA_FPS - 5:
                    self.camera = cap
                    self.actual_width = actual_width
                    self.actual_height = actual_height
                    self.actual_fps = actual_fps
                    
                    print(f"SUCCESS: Camera ready: {actual_width}x{actual_height} @ {actual_fps:.0f}fps ({backend_name}, {fourcc})")
                    return self.camera
                else:
                    print(f"    Only {actual_fps:.0f}fps, trying next...")
                    cap.release()
        
        # If nothing worked, fall back to original settings
        print("  Warning: Could not achieve target FPS, using fallback...")
        self.camera, self.actual_width, self.actual_height, self.actual_fps, fourcc = self._try_camera_setup(
            cv2.CAP_DSHOW, CAMERA_WIDTH, CAMERA_HEIGHT, CAMERA_FPS
        )
        print(f"Camera ready: {self.actual_width}x{self.actual_height} @ {self.actual_fps:.0f}fps ({fourcc}, fallback)")
        
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