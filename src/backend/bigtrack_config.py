"""
BigTrack Navigation Configuration
Adjustable settings for foot mouse navigation
"""

# USB Device IDs
BIGTRACK_VENDOR_ID = 0x2046
BIGTRACK_PRODUCT_ID = 0x0126

# Movement sensitivity
MOVEMENT_SENSITIVITY = 0.005  # How fast position accumulates from mouse movement
VERTICAL_MULTIPLIER = 1.5     # Vertical scroll speed multiplier (1.0 = same as horizontal)

# Navigation thresholds
NAV_THRESHOLD = 0.3      # Position threshold to trigger navigation (±0.3)
MAX_POSITION = 1.0       # Maximum accumulated position before clamping

# Click detection
DOUBLE_CLICK_THRESHOLD = 0.5  # Seconds between clicks to register as double-click

# USB timeout
USB_READ_TIMEOUT = 1000  # Milliseconds