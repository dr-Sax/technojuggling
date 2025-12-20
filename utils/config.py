"""
Configuration settings for Tell-A-Vision server
"""

# ===== GPU SETTINGS =====
USE_NVENC = True  # Enable NVENC hardware encoding (if available)

# ===== CAMERA SETTINGS =====
CAMERA_INDEX = 0  # Camera device index (0, 1, 2, etc.)
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
CAMERA_FPS = 60
CAMERA_BUFFER_SIZE = 1

# Camera Lighting/Exposure
CAMERA_BRIGHTNESS = 150
CAMERA_CONTRAST = 140
CAMERA_SATURATION = 140
CAMERA_EXPOSURE = -5

# ===== ENCODING SETTINGS =====
JPEG_QUALITY = 85
TARGET_FPS = 60

# ===== TRACKING SETTINGS =====
# Hand Tracking
HAND_TRACKING_ENABLED = True
HAND_TRACKING_SKIP = 2  # Process every Nth frame (1 = every frame, 2 = every other frame)
MAX_NUM_HANDS = 2
MIN_DETECTION_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.5
HAND_MODEL_COMPLEXITY = 0  # 0 = lite, 1 = full (lite is faster)

# Ball Tracking
BALL_TRACKING_ENABLED = True
NUM_BALLS = 1
MIN_BALL_RADIUS = 5
MAX_BALL_RADIUS = 100
MIN_BALL_AREA = 50

# ===== SERVER SETTINGS =====
DEFAULT_PORT = 5000
HOST = "127.0.0.1"

# ===== PERFORMANCE SETTINGS =====
FRAME_BUFFER_SIZE = 30  # For FPS calculation