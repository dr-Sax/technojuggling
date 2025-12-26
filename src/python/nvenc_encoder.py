"""
NVENC GPU Encoder using PyNvVideoCodec
Hardware-accelerated H.264 encoding with NVIDIA RTX GPUs
"""
import numpy as np
import cv2

# Try to import NVIDIA encoder
NVENC_AVAILABLE = False
NVENC_ERROR = None

try:
    import PyNvVideoCodec as nvc
    NVENC_AVAILABLE = True
    print("[NVENC] PyNvVideoCodec loaded successfully")
except ImportError as e:
    NVENC_ERROR = f"PyNvVideoCodec not installed: {e}"
    print(f"[NVENC] {NVENC_ERROR}")
except Exception as e:
    NVENC_ERROR = f"Error loading PyNvVideoCodec: {e}"
    print(f"[NVENC] {NVENC_ERROR}")

class NVENCEncoder:
    """NVENC GPU encoder using PyNvVideoCodec"""
    
    def __init__(self, width, height, fps=30, bitrate=4000000):
        self.width = width
        self.height = height
        self.fps = fps
        self.bitrate = bitrate
        self.encoder = None
        self.use_nvenc = False
        
        if NVENC_AVAILABLE:
            try:
                self._init_nvenc()
                self.use_nvenc = True
                print(f"[NVENC] GPU encoder initialized: {width}x{height} @ {fps}fps, {bitrate/1000000}Mbps")
            except Exception as e:
                print(f"[NVENC] Failed to initialize: {e}")
                self.use_nvenc = False
        else:
            print("[NVENC] Not available - using CPU JPEG")
    
    def _init_nvenc(self):
        """Initialize NVENC encoder with PyNvVideoCodec API"""
        # Create encoder instance
        self.encoder = nvc.CreateEncoder(
            width=self.width,
            height=self.height,
            format=nvc.PixelFormat.NV12,
            codec=nvc.CudaVideoCodec.H264,
            preset=nvc.Preset.P4,  # Low latency
            tuningInfo=nvc.TuningInfo.ULTRA_LOW_LATENCY,
            gopLength=self.fps,
            avgBitrate=self.bitrate,
            fps=self.fps,
            deviceId=0  # GPU 0
        )
        
        print(f"[NVENC] Encoder created successfully")
    
    def encode(self, frame, jpeg_quality=85):
        """
        Encode frame using NVENC or fallback to JPEG
        
        Args:
            frame: BGR numpy array from OpenCV (HxWx3)
            jpeg_quality: Fallback JPEG quality
            
        Returns:
            bytes: Encoded frame
        """
        if self.use_nvenc and self.encoder:
            try:
                return self._encode_nvenc(frame)
            except Exception as e:
                print(f"[NVENC] Encode error: {e}, falling back to JPEG")
                self.use_nvenc = False
        
        # Fallback to JPEG
        return self._encode_jpeg(frame, jpeg_quality)
    
    def _encode_nvenc(self, frame):
        """Encode using NVENC"""
        # Convert BGR to NV12 format
        yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420)
        
        # Reshape to match expected format
        nv12_data = np.frombuffer(yuv.tobytes(), dtype=np.uint8)
        
        # Encode
        encoded_packet = self.encoder.Encode(nv12_data)
        
        if encoded_packet and len(encoded_packet) > 0:
            return bytes(encoded_packet)
        else:
            # Frame might be buffered, return empty
            return b''
    
    def _encode_jpeg(self, frame, quality):
        """CPU JPEG encoding fallback"""
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buffer.tobytes()
    
    def is_using_gpu(self):
        """Check if GPU encoding is active"""
        return self.use_nvenc
    
    def release(self):
        """Release encoder"""
        if self.encoder:
            try:
                del self.encoder
                self.encoder = None
            except:
                pass

class JPEGEncoder:
    """CPU JPEG encoder fallback"""
    
    def __init__(self, width, height, fps=30, bitrate=None):
        self.width = width
        self.height = height
        print(f"[JPEG] CPU encoder initialized: {width}x{height}")
    
    def encode(self, frame, jpeg_quality=85):
        """Encode using CPU JPEG"""
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        return buffer.tobytes()
    
    def is_using_gpu(self):
        return False
    
    def release(self):
        pass

def create_encoder(width, height, fps=30, use_nvenc=True):
    """
    Create appropriate encoder
    
    Args:
        width: Frame width
        height: Frame height  
        fps: Target framerate
        use_nvenc: Try NVENC (falls back to JPEG if unavailable)
        
    Returns:
        Encoder instance (NVENC or JPEG)
    """
    if use_nvenc and NVENC_AVAILABLE:
        encoder = NVENCEncoder(width, height, fps)
        if encoder.is_using_gpu():
            return encoder
    
    return JPEGEncoder(width, height, fps)