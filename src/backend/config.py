"""
Configuration settings for Tell-A-Vision server
OPTIMIZED FOR LOW LATENCY
"""

# ===== GPU SETTINGS =====
USE_NVENC = True  # Enable NVENC hardware encoding (if available)

# ===== CAMERA SETTINGS =====
CAMERA_INDEX = 0  # Camera device index (0, 1, 2, etc.)
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 360
CAMERA_FPS = 60
CAMERA_BUFFER_SIZE = 1

# Camera Lighting/Exposure
CAMERA_BRIGHTNESS = 150
CAMERA_CONTRAST = 140
CAMERA_SATURATION = 140
CAMERA_EXPOSURE = -5

# ===== ENCODING SETTINGS =====
JPEG_QUALITY = 60  # REDUCED from 85 - faster encoding, still good quality
TARGET_FPS = 60

# ===== TRACKING SETTINGS =====
# Tracking Mode: "hands", "balls", "both", "none"
TRACKING_MODE = "balls"

# Hand Tracking
HAND_TRACKING_SKIP = 1  # Process EVERY frame for lower latency
MAX_NUM_HANDS = 2
MIN_DETECTION_CONFIDENCE = 0.3
MIN_TRACKING_CONFIDENCE = 0.3
HAND_MODEL_COMPLEXITY = 0  # 0 = lite, 1 = full (lite is faster)

# Ball Tracking
NUM_BALLS = 3
MIN_BALL_RADIUS = 5
MAX_BALL_RADIUS = 100
MIN_BALL_AREA = 50
USE_OPTICAL_FLOW = False  # Add velocity vectors to ball tracking

# ===== SERVER SETTINGS =====
DEFAULT_PORT = 5000
HOST = "127.0.0.1"

# ===== PERFORMANCE SETTINGS =====
FRAME_BUFFER_SIZE = 30  # For FPS calculation

# ===== LATENCY OPTIMIZATION =====
SEND_TRACKING_SEPARATELY = True  # NEW: Send tracking data separately from frames

# ===== BIGTRACK FOOT MOUSE =====
BIGTRACK_VENDOR_ID = 0x2046
BIGTRACK_PRODUCT_ID = 0x0126
BIGTRACK_SENSITIVITY = 0.005
BIGTRACK_VERTICAL_MULTIPLIER = 3.0
BIGTRACK_NAV_THRESHOLD = 0.3
BIGTRACK_DOUBLE_CLICK_THRESHOLD = 0.5