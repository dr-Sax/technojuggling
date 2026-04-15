#!/usr/bin/env python3
"""
Tell-A-Vision Server - Ball tracking + WebSocket streaming
Supports dual cameras: one for tracking, one for streaming.
"""
import asyncio
import websockets
import sys

from config import *
from pipeline import Camera, DualFramePipeline
from ball_tracking import BallTracker
from websocket_handler import WebSocketHandler

def print_banner():
    print("=" * 70)
    print("TELL-A-VISION SERVER (Dual Camera)")
    print("=" * 70)
    print(f"   Camera A (index {CAMERA_A_INDEX}): {CAMERA_A_WIDTH}x{CAMERA_A_HEIGHT} @ {CAMERA_A_FPS}fps")
    print(f"   Camera B (index {CAMERA_B_INDEX}): {CAMERA_B_WIDTH}x{CAMERA_B_HEIGHT} @ {CAMERA_B_FPS}fps")
    print(f"   Tracking source:  Camera {TRACKING_SOURCE}")
    print(f"   Streaming source: Camera {STREAMING_SOURCE}")
    print(f"   Ball tracking: {NUM_BALLS} balls")
    print()

# Global objects
calibration_ready_event = asyncio.Event()
ball_tracker = None
calibration_settings = None

def create_camera(source_id):
    """Create a Camera instance from a source identifier ('A' or 'B')"""
    if source_id == "A":
        return Camera(
            index=CAMERA_A_INDEX,
            width=CAMERA_A_WIDTH,
            height=CAMERA_A_HEIGHT,
            fps=CAMERA_A_FPS,
            resolution_attempts=CAMERA_A_RESOLUTION_ATTEMPTS,
            brightness=CAMERA_A_BRIGHTNESS,
            contrast=CAMERA_A_CONTRAST,
            saturation=CAMERA_A_SATURATION,
            exposure=CAMERA_A_EXPOSURE,
            label=f"Camera-A (idx {CAMERA_A_INDEX})"
        )
    elif source_id == "B":
        return Camera(
            index=CAMERA_B_INDEX,
            width=CAMERA_B_WIDTH,
            height=CAMERA_B_HEIGHT,
            fps=CAMERA_B_FPS,
            resolution_attempts=CAMERA_B_RESOLUTION_ATTEMPTS,
            brightness=CAMERA_B_BRIGHTNESS,
            contrast=CAMERA_B_CONTRAST,
            saturation=CAMERA_B_SATURATION,
            exposure=CAMERA_B_EXPOSURE,
            label=f"Camera-B (idx {CAMERA_B_INDEX})"
        )
    else:
        raise ValueError(f"Unknown camera source: {source_id}")

async def initialize_system():
    global ball_tracker
    
    print_banner()
    
    # Initialize cameras
    # If both sources point to the same camera index, only create one instance
    same_source = (TRACKING_SOURCE == STREAMING_SOURCE)
    
    if same_source:
        print(f"[INIT] Single camera mode (both tracking & streaming on Camera {TRACKING_SOURCE})")
        shared_camera = create_camera(TRACKING_SOURCE)
        shared_camera.initialize()
        tracking_camera = shared_camera
        streaming_camera = shared_camera
    else:
        print(f"[INIT] Dual camera mode")
        print(f"[INIT] Initializing tracking camera (Camera {TRACKING_SOURCE})...")
        tracking_camera = create_camera(TRACKING_SOURCE)
        tracking_camera.initialize()
        
        print(f"[INIT] Initializing streaming camera (Camera {STREAMING_SOURCE})...")
        streaming_camera = create_camera(STREAMING_SOURCE)
        streaming_camera.initialize()
    
    print("[INIT] Creating ball tracker...")
    ball_tracker = BallTracker(tracking_camera.device)
    print("[INIT] Ball tracker created (not calibrated yet)")
    
    return tracking_camera, streaming_camera

async def run_calibration():
    global ball_tracker, calibration_settings
    
    print("\n[CALIBRATION] Starting calibration...")
    calibration_settings = await ball_tracker.initialize()
    print("[CALIBRATION] Calibration complete!")
    calibration_ready_event.set()

async def main():
    global ball_tracker, calibration_settings
    
    tracking_camera, streaming_camera = await initialize_system()
    
    # WebSocket handler uses streaming camera dimensions
    ws_handler = WebSocketHandler(
        frame_processor=None,
        camera_dimensions=streaming_camera.get_dimensions()
    )
    ws_handler.on_first_connection = lambda: asyncio.create_task(run_calibration())
    
    # BigTrack foot mouse — optional, won't crash if device is absent
    try:
        from bigtrack_handler import BigTrackHandler
        loop = asyncio.get_event_loop()
        bigtrack = BigTrackHandler(ws_handler, loop)
        bigtrack.start()
        print("[MAIN] BigTrack foot mouse started")
    except Exception as e:
        print(f"[MAIN] BigTrack unavailable ({e}) — continuing without foot mouse")
    
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    
    server = await websockets.serve(
        ws_handler.handle_client,
        HOST,
        port
    )
    
    print("=" * 70)
    dims = streaming_camera.get_dimensions()
    print(f"Server running on ws://{HOST}:{port}")
    print(f"Streaming: {dims[0]}x{dims[1]} @ {dims[2]:.0f}fps (Camera {STREAMING_SOURCE})")
    t_dims = tracking_camera.get_dimensions()
    print(f"Tracking:  {t_dims[0]}x{t_dims[1]} @ {t_dims[2]:.0f}fps (Camera {TRACKING_SOURCE})")
    print("=" * 70)
    print("\nWaiting for client connection...\n")
    
    await calibration_ready_event.wait()
    
    # Create dual pipeline
    pipeline = DualFramePipeline(
        tracking_camera=tracking_camera,
        streaming_camera=streaming_camera,
        ball_tracker=ball_tracker
    )
    pipeline.start()
    
    ws_handler.frame_processor = pipeline
    ws_handler.set_calibration_settings(calibration_settings)
    
    print("=" * 70)
    print("READY - Streaming enabled")
    print("=" * 70)
    
    try:
        await asyncio.Future()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        pipeline.stop()
        tracking_camera.release()
        if streaming_camera is not tracking_camera:
            streaming_camera.release()
        print("Server stopped")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nGoodbye!")