"""
Configuration settings for Tell-A-Vision server
"""

# ===== DUAL CAMERA SETTINGS =====
# Camera A: Overhead webcam (for ball tracking)
# Camera B: HDMI capture card (phone content for streaming)
#
# TRACKING_SOURCE controls which camera feeds ball detection: "A" or "B"
# STREAMING_SOURCE controls which camera gets encoded & sent to frontend: "A" or "B"
# Typically: track on A (webcam), stream from B (capture card)

CAMERA_A_INDEX = 0     # Overhead webcam
CAMERA_B_INDEX = 5          # HDMI capture card (phone)

TRACKING_SOURCE = "A"       # Which camera to run ball detection on
STREAMING_SOURCE = "B"      # Which camera to stream to frontend

# --- Camera A settings (webcam) ---
CAMERA_A_WIDTH = 630
CAMERA_A_HEIGHT = 360
CAMERA_A_FPS = 30
CAMERA_A_RESOLUTION_ATTEMPTS = [
    (630, 360),
]
CAMERA_A_BRIGHTNESS = 150  # 150
CAMERA_A_CONTRAST = 140  # 140
CAMERA_A_SATURATION = 140  # 140
CAMERA_A_EXPOSURE = -5 # -5

# --- Camera B settings (capture card / phone) ---
CAMERA_B_WIDTH = 2532/2
CAMERA_B_HEIGHT = 1170/2
CAMERA_B_FPS = 30
CAMERA_B_RESOLUTION_ATTEMPTS = [
    (2532/2, 1170/2),
]
CAMERA_B_BRIGHTNESS = 150
CAMERA_B_CONTRAST = 140
CAMERA_B_SATURATION = 140
CAMERA_B_EXPOSURE = -5

# ===== LEGACY SINGLE-CAMERA ALIASES =====
# These point to the streaming source so existing code that reads them still works.
CAMERA_INDEX = CAMERA_B_INDEX
CAMERA_WIDTH = CAMERA_B_WIDTH
CAMERA_HEIGHT = CAMERA_B_HEIGHT
CAMERA_FPS = CAMERA_B_FPS
RESOLUTION_ATTEMPTS = CAMERA_B_RESOLUTION_ATTEMPTS
CAMERA_BUFFER_SIZE = 1

CAMERA_BRIGHTNESS = CAMERA_B_BRIGHTNESS
CAMERA_CONTRAST = CAMERA_B_CONTRAST
CAMERA_SATURATION = CAMERA_B_SATURATION
CAMERA_EXPOSURE = CAMERA_B_EXPOSURE

# ===== ENCODING SETTINGS =====
JPEG_QUALITY = 60
TARGET_FPS = 30

# ===== BALL TRACKING SETTINGS =====
NUM_BALLS = 4
MIN_BALL_RADIUS = 5
MAX_BALL_RADIUS = 100
MIN_BALL_AREA = 50

# ===== SERVER SETTINGS =====
DEFAULT_PORT = 5000
HOST = "127.0.0.1"

# ===== PERFORMANCE SETTINGS =====
FRAME_BUFFER_SIZE = 30