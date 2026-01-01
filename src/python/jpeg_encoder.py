"""
CPU JPEG Encoder - Simple and fast CPU-based encoding
"""
import cv2

class JPEGEncoder:
    """CPU JPEG encoder"""
    
    def __init__(self, width, height, fps=30):
        self.width = width
        self.height = height
        self.fps = fps
        print(f"[ENCODER] CPU JPEG initialized: {width}x{height} @ {fps}fps")
    
    def encode(self, frame, jpeg_quality=85):
        """Encode frame using CPU JPEG"""
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        return buffer.tobytes()
    
    def is_using_gpu(self):
        """Check if GPU encoding is active (always False for CPU encoder)"""
        return False
    
    def release(self):
        """Release encoder resources"""
        pass

def create_encoder(width, height, fps=30):
    """
    Create CPU JPEG encoder
    
    Args:
        width: Frame width
        height: Frame height  
        fps: Target framerate
        
    Returns:
        JPEGEncoder instance
    """
    return JPEGEncoder(width, height, fps)