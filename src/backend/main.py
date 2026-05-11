#!/usr/bin/env python3
"""
Tell-A-Vision Server - Ball tracking + WebSocket streaming (single camera)
"""
import asyncio
import websockets
import sys

from config import *
from pipeline import Camera, FramePipeline
from ball_tracking import BallTracker
from websocket_handler import WebSocketHandler

def print_banner():
    print("=" * 70)
    print("TELL-A-VISION SERVER")
    print("=" * 70)
    print(f"   Camera (index {CAMERA_INDEX}): {CAMERA_WIDTH}x{CAMERA_HEIGHT} @ {CAMERA_FPS}fps")
    print(f"   Ball tracking: {NUM_BALLS} balls")
    print()

# Global objects
calibration_ready_event = asyncio.Event()
ball_tracker = None
calibration_settings = None

async def initialize_system():
    global ball_tracker

    print_banner()

    print(f"[INIT] Initializing camera...")
    camera = Camera(
        index=CAMERA_INDEX,
        width=CAMERA_WIDTH,
        height=CAMERA_HEIGHT,
        fps=CAMERA_FPS,
        resolution_attempts=CAMERA_RESOLUTION_ATTEMPTS,
        brightness=CAMERA_BRIGHTNESS,
        contrast=CAMERA_CONTRAST,
        saturation=CAMERA_SATURATION,
        exposure=CAMERA_EXPOSURE,
        label=f"Camera (idx {CAMERA_INDEX})"
    )
    camera.initialize()

    print("[INIT] Creating ball tracker...")
    ball_tracker = BallTracker(camera.device)
    print("[INIT] Ball tracker created (not calibrated yet)")

    return camera

async def run_calibration():
    global ball_tracker, calibration_settings

    print("\n[CALIBRATION] Starting calibration...")
    calibration_settings = await ball_tracker.initialize()
    print("[CALIBRATION] Calibration complete!")
    calibration_ready_event.set()

async def main():
    global ball_tracker, calibration_settings

    camera = await initialize_system()

    ws_handler = WebSocketHandler(
        frame_processor=None,
        camera_dimensions=camera.get_dimensions()
    )
    ws_handler.on_first_connection = lambda: asyncio.create_task(run_calibration())

    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT

    server = await websockets.serve(
        ws_handler.handle_client,
        HOST,
        port
    )

    print("=" * 70)
    dims = camera.get_dimensions()
    print(f"Server running on ws://{HOST}:{port}")
    print(f"Camera: {dims[0]}x{dims[1]} @ {dims[2]:.0f}fps")
    print("=" * 70)
    print("\nWaiting for client connection...\n")

    await calibration_ready_event.wait()

    pipeline = FramePipeline(camera=camera, ball_tracker=ball_tracker)
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
        camera.release()
        print("Server stopped")

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nGoodbye!")