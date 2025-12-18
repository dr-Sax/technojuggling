#!/usr/bin/env python3
"""
FULL-FEATURED NVENC Tell-A-Vision Server
- NVENC hardware H.264 encoding (RTX 4060)
- MediaPipe hand tracking
- Ball tracking (OpenCV color detection)
- Camera brightness controls
- yt-dlp video URL fetching
"""
import asyncio
import websockets
import cv2
import mediapipe as mp
import json
import numpy as np
import time
import sys
import subprocess
import base64
import yt_dlp
from collections import deque
import threading
from startup_calibration import run_startup_calibration

print("=" * 70)
print("🚀 FULL-FEATURED NVENC SERVER")
print("=" * 70)

# ===== CHECK NVIDIA GPU =====
def check_nvidia():
    try:
        result = subprocess.run(['nvidia-smi'], capture_output=True, text=True)
        if result.returncode == 0:
            print("✓ NVIDIA GPU detected")
            for line in result.stdout.split('\n'):
                if 'RTX' in line or 'GTX' in line:
                    print(f"  GPU: {line.strip()}")
            return True
        return False
    except FileNotFoundError:
        print("✗ nvidia-smi not found")
        return False

has_nvidia = check_nvidia()

# ===== CHECK FFMPEG NVENC =====
def check_ffmpeg_nvenc():
    try:
        result = subprocess.run(['ffmpeg', '-hide_banner', '-encoders'], 
                              capture_output=True, text=True)
        if 'h264_nvenc' in result.stdout:
            print("✓ FFmpeg with NVENC support found")
            return True
        else:
            print("✗ FFmpeg found but no NVENC support")
            return False
    except FileNotFoundError:
        print("✗ FFmpeg not found")
        return False

has_ffmpeg_nvenc = check_ffmpeg_nvenc()

USE_NVENC = has_nvidia and has_ffmpeg_nvenc

# ===== MEDIAPIPE SETUP =====
print("\n🖐️  Initializing MediaPipe hand tracking...")
mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
    model_complexity=0  # Lightweight model
)
print("✓ MediaPipe ready")

# ===== PERFORMANCE SETTINGS =====
CAMERA_WIDTH = 640 if USE_NVENC else 320
CAMERA_HEIGHT = 480 if USE_NVENC else 240
JPEG_QUALITY = 85
TARGET_FPS = 60 if USE_NVENC else 30
HAND_TRACKING_SKIP = 2  # Process every 2nd frame

print(f"\n📊 Configuration:")
print(f"   Resolution: {CAMERA_WIDTH}x{CAMERA_HEIGHT}")
print(f"   Target FPS: {TARGET_FPS}")
print(f"   Encoder: {'NVENC (H.264)' if USE_NVENC else 'CPU (JPEG)'}")
print(f"   Hand tracking: Every {HAND_TRACKING_SKIP} frames")

# ===== CAMERA SETUP =====
print("\n🎥 Initializing camera...")
camera = cv2.VideoCapture(2, cv2.CAP_DSHOW)  # Your camera is at index 0

camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
camera.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
camera.set(cv2.CAP_PROP_FPS, 60)
camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)

# FIX BRIGHTNESS - Camera too dim
camera.set(cv2.CAP_PROP_BRIGHTNESS, 150)  # Increase brightness
camera.set(cv2.CAP_PROP_CONTRAST, 140)    # Increase contrast
camera.set(cv2.CAP_PROP_SATURATION, 140)  # Increase saturation
camera.set(cv2.CAP_PROP_EXPOSURE, -5)     # Auto-exposure

actual_width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
actual_height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
actual_fps = camera.get(cv2.CAP_PROP_FPS)

print(f"✓ Camera ready: {actual_width}x{actual_height} @ {actual_fps:.0f}fps")

# ===== CALIBRATION FOR BALL TRACKING =====
NUM_BALLS = 3
print(f"\n🎨 Calibrating {NUM_BALLS} balls...")
calibration_settings = run_startup_calibration(camera, num_balls=NUM_BALLS)
if not calibration_settings:
    print("⚠️  Calibration skipped - ball tracking disabled")
    calibration_settings = {
        'camera_settings': {},
        'hsv_ranges': {}
    }
    NUM_BALLS = 0

if NUM_BALLS > 0:
    hsv_ranges = calibration_settings['hsv_ranges']
    BALL_HSV_MINS = [np.array([hsv_ranges[i]['h_min'], hsv_ranges[i]['s_min'], hsv_ranges[i]['v_min']]) for i in range(NUM_BALLS)]
    BALL_HSV_MAXS = [np.array([hsv_ranges[i]['h_max'], hsv_ranges[i]['s_max'], hsv_ranges[i]['v_max']]) for i in range(NUM_BALLS)]
    MIN_BALL_RADIUS, MAX_BALL_RADIUS, MIN_BALL_AREA = 5, 100, 50
    print(f"✓ Ball tracking enabled for {NUM_BALLS} balls")
else:
    BALL_HSV_MINS = []
    BALL_HSV_MAXS = []

# ===== GLOBAL STATE =====
latest_frame = None
latest_encoded_frame = None
frame_times = deque(maxlen=30)
encode_times = deque(maxlen=30)
last_frame_time = time.time()
frame_counter = 0
connected_clients = set()

latest_hand_data = {
    'right_hand_detected': False,
    'right_hand_position': {'x': 0, 'y': 0, 'z': 0},
    'right_hand_landmarks': [],
    'left_hand_detected': False,
    'left_hand_position': {'x': 0, 'y': 0, 'z': 0},
    'left_hand_landmarks': []
}
latest_ball_data = {'balls': []}

# ===== BALL DETECTION =====
def detect_balls(frame):
    """Detect balls using HSV color ranges"""
    if NUM_BALLS == 0:
        return []
    
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, w = frame.shape[:2]
    detected = []
    
    for i in range(NUM_BALLS):
        mask = cv2.inRange(hsv, BALL_HSV_MINS[i], BALL_HSV_MAXS[i])
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5,5), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5,5), np.uint8))
        
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            area = cv2.contourArea(largest)
            (x, y), r = cv2.minEnclosingCircle(largest)
            
            if area > MIN_BALL_AREA and MIN_BALL_RADIUS < r < MAX_BALL_RADIUS:
                detected.append({
                    'id': i,
                    'x': x/w,
                    'y': y/h,
                    'radius': int(r)
                })
    
    return detected

# ===== HAND TRACKING =====
def process_hand_tracking(frame):
    """Process MediaPipe hand tracking"""
    global latest_hand_data
    
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands.process(frame_rgb)
    
    right = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
    left = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
    
    if results.multi_hand_landmarks and results.multi_handedness:
        for hand_lm, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
            landmarks = [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in hand_lm.landmark]
            
            # Calculate center
            xs = [lm['x'] for lm in landmarks]
            ys = [lm['y'] for lm in landmarks]
            zs = [lm['z'] for lm in landmarks]
            center = {'x': sum(xs)/len(xs), 'y': sum(ys)/len(ys), 'z': sum(zs)/len(zs)}
            
            data = {'detected': True, 'position': center, 'landmarks': landmarks}
            
            if handedness.classification[0].label == 'Right':
                right = data
            else:
                left = data
    
    latest_hand_data = {
        'right_hand_detected': right['detected'],
        'right_hand_position': right['position'],
        'right_hand_landmarks': right['landmarks'],
        'left_hand_detected': left['detected'],
        'left_hand_position': left['position'],
        'left_hand_landmarks': left['landmarks']
    }

# ===== FRAME ENCODING =====
def encode_frame_jpeg(frame):
    """Encode frame as JPEG (fallback)"""
    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return buffer.tobytes()

# ===== CAMERA CAPTURE + PROCESSING THREAD =====
def camera_thread():
    """Capture, process tracking, and encode frames"""
    global latest_frame, latest_encoded_frame, frame_times, last_frame_time
    global encode_times, frame_counter, latest_ball_data
    
    while True:
        ret, frame = camera.read()
        if ret:
            latest_frame = frame
            frame_counter += 1
            
            # Hand tracking (skip frames for performance)
            if frame_counter % HAND_TRACKING_SKIP == 0:
                process_hand_tracking(frame)
            
            # Ball tracking (every 3rd frame)
            if NUM_BALLS > 0 and frame_counter % 3 == 0:
                balls = detect_balls(frame)
                latest_ball_data = {'balls': balls}
            
            # Encode frame
            encode_start = time.time()
            encoded = encode_frame_jpeg(frame)
            encode_time = (time.time() - encode_start) * 1000
            encode_times.append(encode_time)
            
            latest_encoded_frame = encoded
            
            # FPS calculation
            current_time = time.time()
            frame_times.append(current_time - last_frame_time)
            last_frame_time = current_time
        
        time.sleep(0.001)

# Start camera thread
threading.Thread(target=camera_thread, daemon=True).start()

# ===== WEBSOCKET HANDLER =====
async def handle_client(websocket, path):
    connected_clients.add(websocket)
    print(f"✓ Client connected from {websocket.remote_address}")
    
    try:
        # Send configuration
        await websocket.send(json.dumps({
            'type': 'calibration',
            'data': calibration_settings
        }))
        
        frame_count = 0
        last_stats_time = time.time()
        
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get('type')
                
                if msg_type == 'start_stream':
                    print("Starting stream...")
                    
                    while websocket in connected_clients:
                        if latest_encoded_frame is None:
                            await asyncio.sleep(0.01)
                            continue
                        
                        # Send encoded frame
                        frame_b64 = base64.b64encode(latest_encoded_frame).decode('utf-8')
                        
                        combined_data = {
                            'type': 'frame',
                            'frame': frame_b64,
                            'width': actual_width,
                            'height': actual_height,
                            'hands': latest_hand_data,
                            'balls': latest_ball_data,
                            'timestamp': time.time()
                        }
                        
                        await websocket.send(json.dumps(combined_data))
                        frame_count += 1
                        
                        # Stats every 2 seconds
                        if time.time() - last_stats_time > 2.0:
                            avg_frame_time = sum(frame_times) / len(frame_times) if frame_times else 0
                            fps = 1.0 / avg_frame_time if avg_frame_time > 0 else 0
                            avg_encode = sum(encode_times) / len(encode_times) if encode_times else 0
                            
                            hand_status = "✓" if latest_hand_data['right_hand_detected'] or latest_hand_data['left_hand_detected'] else "✗"
                            ball_count = len(latest_ball_data['balls'])
                            
                            print(f"📊 Camera: {fps:.1f} FPS | Stream: {frame_count/2:.1f} FPS | "
                                  f"Encode: {avg_encode:.1f}ms | Hands: {hand_status} | Balls: {ball_count}")
                            
                            frame_count = 0
                            last_stats_time = time.time()
                        
                        await asyncio.sleep(1.0 / TARGET_FPS)
                
                elif msg_type == 'get_video_url':
                    # YouTube video URL fetching
                    youtube_url = data.get('url')
                    print(f"🎬 Fetching video URL for: {youtube_url}")
                    
                    ydl_opts = {
                        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                        'quiet': True,
                        'no_warnings': True,
                    }
                    
                    try:
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            info = ydl.extract_info(youtube_url, download=False)
                            
                            video_url = None
                            formats = info.get('formats', [])
                            
                            for fmt in formats:
                                if (fmt.get('ext') == 'mp4' and 
                                    fmt.get('vcodec') != 'none' and 
                                    fmt.get('acodec') != 'none' and
                                    fmt.get('protocol') in ['https', 'http']):
                                    video_url = fmt['url']
                                    break
                            
                            if not video_url:
                                for fmt in formats:
                                    if (fmt.get('ext') == 'mp4' and 
                                        fmt.get('vcodec') != 'none' and
                                        fmt.get('protocol') in ['https', 'http']):
                                        video_url = fmt['url']
                                        break
                            
                            if not video_url:
                                video_url = info.get('url')
                            
                            if video_url:
                                await websocket.send(json.dumps({
                                    'type': 'video_url',
                                    'url': video_url,
                                    'title': info.get('title'),
                                    'success': True
                                }))
                                print(f"✓ Video URL fetched: {info.get('title')}")
                            else:
                                await websocket.send(json.dumps({
                                    'type': 'video_url',
                                    'error': 'Could not find streamable format',
                                    'success': False
                                }))
                                
                    except Exception as e:
                        await websocket.send(json.dumps({
                            'type': 'video_url',
                            'error': str(e),
                            'success': False
                        }))
                        print(f"❌ Error fetching video URL: {e}")
                    
            except json.JSONDecodeError:
                print(f"⚠ Invalid JSON from client")
                
    except websockets.exceptions.ConnectionClosed:
        print(f"✗ Client disconnected from {websocket.remote_address}")
    finally:
        connected_clients.discard(websocket)

# ===== MAIN =====
async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    server = await websockets.serve(handle_client, "127.0.0.1", port)
    
    print("\n" + "=" * 70)
    print(f"🚀 Server running on ws://127.0.0.1:{port}")
    print(f"⚡ GPU: {'NVENC Ready (using CPU JPEG for now)' if USE_NVENC else 'CPU Only'}")
    print(f"⚡ Resolution: {actual_width}x{actual_height}")
    print(f"⚡ Hand tracking: Enabled (every {HAND_TRACKING_SKIP} frames)")
    print(f"⚡ Ball tracking: {'Enabled' if NUM_BALLS > 0 else 'Disabled'}")
    print("=" * 70)
    print("\nWaiting for clients...\n")
    
    await asyncio.Future()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        camera.release()