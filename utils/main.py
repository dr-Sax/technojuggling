#!/usr/bin/env python3
"""
Tell-A-Vision Server - Main Entry Point
Orchestrates camera, tracking, and WebSocket streaming
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
    print("🎥 TELL-A-VISION SERVER")
    print("=" * 70)
    print()

def print_config():
    """Print current configuration"""
    print("📋 Configuration:")
    print(f"   Camera Index: {CAMERA_INDEX}")
    print(f"   Resolution: {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
    print(f"   Target FPS: {TARGET_FPS}")
    print(f"   Hand Tracking: {'Enabled' if HAND_TRACKING_ENABLED else 'Disabled'}")
    if HAND_TRACKING_ENABLED:
        print(f"     - Skip frames: {HAND_TRACKING_SKIP}")
        print(f"     - Model complexity: {HAND_MODEL_COMPLEXITY}")
    print(f"   Ball Tracking: {'Enabled' if BALL_TRACKING_ENABLED else 'Disabled'}")
    if BALL_TRACKING_ENABLED:
        print(f"     - Number of balls: {NUM_BALLS}")
    print()

async def main():
    """Main server initialization and execution"""
    print_banner()
    print_config()
    
    # Initialize camera
    camera = Camera()
    camera_device = camera.initialize()
    camera_dimensions = camera.get_dimensions()
    
    # Initialize hand tracking
    hand_tracker = HandTracker()
    hand_tracker.initialize()
    
    # Initialize ball tracking
    ball_tracker = BallTracker(camera_device)
    calibration_settings = ball_tracker.initialize()
    
    # Initialize frame processor
    frame_processor = FrameProcessor(camera, hand_tracker, ball_tracker)
    frame_processor.start()
    
    # Initialize video service
    video_service = VideoService()
    
    # Initialize WebSocket handler
    ws_handler = WebSocketHandler(
        frame_processor=frame_processor,
        video_service=video_service,
        calibration_settings=calibration_settings,
        camera_dimensions=camera_dimensions
    )
    
    # Start WebSocket server
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    server = await websockets.serve(
        ws_handler.handle_client,
        HOST,
        port
    )
    
    # Print server info
    print("=" * 70)
    print(f"🚀 Server running on ws://{HOST}:{port}")
    print(f"⚡ Resolution: {camera_dimensions[0]}x{camera_dimensions[1]} @ {camera_dimensions[2]:.0f}fps")
    print(f"⚡ Hand tracking: {'Enabled' if HAND_TRACKING_ENABLED else 'Disabled'}")
    print(f"⚡ Ball tracking: {'Enabled' if BALL_TRACKING_ENABLED else 'Disabled'}")
    print("=" * 70)
    print("\n✓ Waiting for clients...\n")
    
    try:
        # Run forever
        await asyncio.Future()
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
    finally:
        # Cleanup
        frame_processor.stop()
        hand_tracker.release()
        camera.release()
        print("✓ Server stopped")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")