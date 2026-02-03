#!/usr/bin/env python3
"""
Tell-A-Vision Server - Simplified (Ball tracking only)
"""
import asyncio
import websockets
import sys

from config import *
from camera import Camera
from ball_tracking import BallTracker
from frame_processor import FrameProcessor
from websocket_handler import WebSocketHandler
from bigtrack_handler import BigTrackHandler

def print_banner():
    print("=" * 70)
    print("TELL-A-VISION SERVER (Ball Tracking)")
    print("=" * 70)
    print()

def print_config():
    print("Configuration:")
    print(f"   Camera Index: {CAMERA_INDEX}")
    print(f"   Resolution: {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
    print(f"   Target FPS: {TARGET_FPS}")
    print(f"   Tracking: Ball tracking ({NUM_BALLS} balls)")
    print()

# Global objects
calibration_ready_event = asyncio.Event()
ball_tracker = None
calibration_settings = None

async def initialize_system():
    """Initialize camera and ball tracking"""
    global ball_tracker, calibration_settings
    
    print_banner()
    print_config()
    
    # Initialize camera
    print("[INIT] Initializing camera...")
    camera = Camera()
    camera_device = camera.initialize()
    camera_dimensions = camera.get_dimensions()
    print("[INIT] Camera initialized")
    
    # Create ball tracker (calibration happens later)
    print("[INIT] Creating ball tracker...")
    ball_tracker = BallTracker(camera_device)
    print("[INIT] Ball tracker created (not calibrated yet)")
    
    return camera, camera_device, camera_dimensions

async def run_calibration():
    """Run calibration after client connects"""
    global ball_tracker, calibration_settings
    
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
    
    # Initialize system (camera only)
    camera, camera_device, camera_dimensions = await initialize_system()
    
    print("[MAIN] Creating WebSocket handler...")
    ws_handler = WebSocketHandler(
        frame_processor=None,
        camera_dimensions=camera_dimensions
    )
    
    # Store callback to trigger calibration
    ws_handler.on_first_connection = lambda: asyncio.create_task(run_calibration())
    print("[MAIN] WebSocket handler created")

    # Initialize BigTrack handler
    print("[MAIN] Initializing BigTrack foot mouse...")
    loop = asyncio.get_event_loop()
    bigtrack = BigTrackHandler(ws_handler, loop)
    bigtrack.start()
    print("[MAIN] BigTrack handler started")
    
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
    print("=" * 70)
    print("\n[MAIN] Waiting for client connection...\n")
    
    # Wait for calibration to complete
    print("[MAIN] Waiting for calibration_ready_event...")
    await calibration_ready_event.wait()
    print("[MAIN] Calibration ready event received!")
    
    print("\n[MAIN] Starting frame processor...")
    
    # Now initialize frame processor with calibrated tracker
    frame_processor = FrameProcessor(camera, ball_tracker=ball_tracker)
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
        await asyncio.Future()
    except KeyboardInterrupt:
        print("\n[MAIN] Shutting down...")
    finally:
        frame_processor.stop()
        camera.release()
        print("[MAIN] Server stopped")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nGoodbye!")