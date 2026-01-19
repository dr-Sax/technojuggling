#!/usr/bin/env python3
"""
Tell-A-Vision Server - Main Entry Point
"""
import asyncio
import websockets
import sys

# Import all modules
from config import *
from camera import Camera
from hand_tracking import HandTracker
from ball_tracking import BallTracker
from frame_processor import FrameProcessor
from video_service import VideoService
from websocket_handler import WebSocketHandler

def print_banner():
    """Print startup banner"""
    print("=" * 70)
    print("TELL-A-VISION SERVER")
    print("=" * 70)
    print()

def print_config():
    """Print current configuration"""
    print("Configuration:")
    print(f"   Camera Index: {CAMERA_INDEX}")
    print(f"   Resolution: {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
    print(f"   Target FPS: {TARGET_FPS}")
    print(f"   Tracking Mode: {TRACKING_MODE}")
    
    if TRACKING_MODE in ["hands", "both"]:
        print(f"   Hand Tracking:")
        print(f"     - Skip frames: {HAND_TRACKING_SKIP}")
        print(f"     - Model complexity: {HAND_MODEL_COMPLEXITY}")
    
    if TRACKING_MODE in ["balls", "both"]:
        print(f"   Ball Tracking:")
        print(f"     - Number of balls: {NUM_BALLS}")
        print(f"     - Optical flow: {'Enabled' if USE_OPTICAL_FLOW else 'Disabled'}")
    
    print()

# Global objects
calibration_ready_event = asyncio.Event()
ball_tracker = None
hand_tracker = None
calibration_settings = None

async def initialize_system():
    """Initialize camera and tracking based on TRACKING_MODE"""
    global ball_tracker, hand_tracker, calibration_settings
    
    print_banner()
    print_config()
    
    # Initialize camera
    print("[INIT] Initializing camera...")
    camera = Camera()
    camera_device = camera.initialize()
    camera_dimensions = camera.get_dimensions()
    print("[INIT] Camera initialized")
    
    # Initialize hand tracking if enabled
    if TRACKING_MODE in ["hands", "both"]:
        print("[INIT] Initializing hand tracking...")
        hand_tracker = HandTracker()
        hand_tracker.initialize()
        print("[INIT] Hand tracking initialized")
    else:
        print("[INIT] Hand tracking disabled by TRACKING_MODE")
        hand_tracker = None
    
    # Create ball tracker if enabled (but don't initialize yet - waits for calibration)
    if TRACKING_MODE in ["balls", "both"]:
        print("[INIT] Creating ball tracker...")
        ball_tracker = BallTracker(camera_device)
        print("[INIT] Ball tracker created (awaiting calibration)")
    else:
        print("[INIT] Ball tracking disabled by TRACKING_MODE")
        ball_tracker = None
        # Set event immediately if no ball calibration needed
        calibration_settings = {'camera_settings': {}, 'hsv_ranges': {}}
        calibration_ready_event.set()
    
    return camera, camera_device, camera_dimensions

async def run_calibration():
    """Run calibration after client connects (only if ball tracking enabled)"""
    global ball_tracker, calibration_settings
    
    if ball_tracker is None:
        print("[CALIBRATION] Skipped - ball tracking disabled")
        return
    
    print("\n[CALIBRATION] Starting calibration...")
    print("[CALIBRATION] Waiting for user choice from WebSocket...")
    
    calibration_settings = await ball_tracker.initialize()
    
    print("[CALIBRATION] Calibration complete!")
    print(f"[CALIBRATION] Settings: {calibration_settings is not None}")
    
    calibration_ready_event.set()
    print("[CALIBRATION] Event set - main can continue")

async def main():
    """Main server initialization and execution"""
    
    print("[MAIN] Starting initialization...")
    
    # Initialize system (camera, tracking based on mode)
    camera, camera_device, camera_dimensions = await initialize_system()
    
    print("[MAIN] Creating WebSocket handler...")
    # Create WebSocket handler
    video_service = VideoService()
    ws_handler = WebSocketHandler(
        frame_processor=None,  # Will set after calibration
        video_service=video_service,
        camera_dimensions=camera_dimensions
    )
    
    # Store callback to trigger calibration (only if ball tracking enabled)
    if ball_tracker is not None:
        ws_handler.on_first_connection = lambda: asyncio.create_task(run_calibration())
    print("[MAIN] WebSocket handler created")
    
    # Start WebSocket server
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    print(f"[MAIN] Starting WebSocket server on port {port}...")
    
    server = await websockets.serve(
        ws_handler.handle_client,
        HOST,
        port
    )
    
    print("=" * 70)
    print(f"Server running on ws://{HOST}:{port}")
    print(f"Resolution: {camera_dimensions[0]}x{camera_dimensions[1]} @ {camera_dimensions[2]:.0f}fps")
    print(f"Tracking mode: {TRACKING_MODE}")
    print("=" * 70)
    print("\n[MAIN] Waiting for client connection...\n")
    
    # Wait for calibration to complete (immediate if no ball tracking)
    print("[MAIN] Waiting for calibration_ready_event...")
    await calibration_ready_event.wait()
    print("[MAIN] Calibration ready event received!")
    
    print("\n[MAIN] Starting frame processor...")
    
    # Now initialize frame processor with trackers
    frame_processor = FrameProcessor(camera, hand_tracker, ball_tracker)
    frame_processor.start()
    print("[MAIN] Frame processor started")
    
    # Update handler
    ws_handler.frame_processor = frame_processor
    ws_handler.set_calibration_settings(calibration_settings)
    print("[MAIN] Handler updated with frame processor and calibration")
    
    print("=" * 70)
    print("READY - Streaming enabled")
    print("=" * 70)
    print()
    
    try:
        # Run forever
        await asyncio.Future()
    except KeyboardInterrupt:
        print("\n[MAIN] Shutting down...")
    finally:
        # Cleanup
        frame_processor.stop()
        if hand_tracker:
            hand_tracker.release()
        camera.release()
        print("[MAIN] Server stopped")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nGoodbye!")