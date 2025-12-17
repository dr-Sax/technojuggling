#!/usr/bin/env python3
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import yt_dlp, sys, cv2, mediapipe as mp, json, threading, os, time
import usb.core, usb.util, usb.backend.libusb1
import numpy as np
from startup_calibration import run_startup_calibration

app = Flask(__name__)
CORS(app)

mp_hands = mp.solutions.hands
hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2, min_detection_confidence=0.5, min_tracking_confidence=0.5)

# ===== CAMERA SETUP =====
print("🎥 Initializing camera...")
camera = cv2.VideoCapture(0, cv2.CAP_MSMF) if cv2.VideoCapture(0, cv2.CAP_MSMF).isOpened() else cv2.VideoCapture(0)

camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
camera.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
camera.set(cv2.CAP_PROP_FPS, 30)

# Zoom reset cycle
print("🔄 Resetting zoom...")
try:
    camera.set(cv2.CAP_PROP_ZOOM, 150)
    time.sleep(0.3)
    camera.read()
    camera.set(cv2.CAP_PROP_ZOOM, 100)
    time.sleep(0.3)
    camera.read()
except:
    pass

camera.set(cv2.CAP_PROP_AUTOFOCUS, 1)  # Autofocus ON (for focusing on balls)
camera.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)  # Manual exposure mode
camera.set(cv2.CAP_PROP_AUTO_WB, 0)  # Disable auto white balance
print("✓ Camera ready (autofocus enabled, exposure locked)")

# ===== CALIBRATION =====
NUM_BALLS = 3
print(f"\n🎨 Calibrating {NUM_BALLS} balls...")
calibration_settings = run_startup_calibration(camera, num_balls=NUM_BALLS)
if not calibration_settings:
    sys.exit(0)

cam = calibration_settings['camera_settings']
camera.set(cv2.CAP_PROP_BRIGHTNESS, cam['brightness'])
camera.set(cv2.CAP_PROP_CONTRAST, cam['contrast'])
camera.set(cv2.CAP_PROP_SATURATION, cam['saturation'])
camera.set(cv2.CAP_PROP_AUTO_EXPOSURE, 1)
camera.set(cv2.CAP_PROP_EXPOSURE, cam['exposure'])
camera.set(cv2.CAP_PROP_GAIN, cam['gain'])

# VERIFY settings actually stuck
time.sleep(0.5)
actual = {
    'brightness': camera.get(cv2.CAP_PROP_BRIGHTNESS),
    'exposure': camera.get(cv2.CAP_PROP_EXPOSURE),
    'gain': camera.get(cv2.CAP_PROP_GAIN),
}
print(f"✓ Camera settings - Set: B={cam['brightness']} E={cam['exposure']} G={cam['gain']}")
print(f"  Actual: B={actual['brightness']} E={actual['exposure']} G={actual['gain']}")

if abs(cam['brightness'] - actual['brightness']) > 1 or abs(cam['exposure'] - actual['exposure']) > 1:
    print(f"  ⚠ WARNING: Settings didn't stick! Calibration won't match tracking!")
    print(f"  → Camera may not support these values or is being overridden")

hsv_ranges = calibration_settings['hsv_ranges']
BALL_HSV_MINS = [np.array([hsv_ranges[i]['h_min'], hsv_ranges[i]['s_min'], hsv_ranges[i]['v_min']]) for i in range(NUM_BALLS)]
BALL_HSV_MAXS = [np.array([hsv_ranges[i]['h_max'], hsv_ranges[i]['s_max'], hsv_ranges[i]['v_max']]) for i in range(NUM_BALLS)]

MIN_BALL_RADIUS, MAX_BALL_RADIUS, MIN_BALL_AREA = 5, 100, 50

# ===== STATE =====
latest_hand_data = {'right_hand_detected': False, 'right_hand_position': {'x': 0, 'y': 0, 'z': 0}, 'right_hand_landmarks': [],
                    'left_hand_detected': False, 'left_hand_position': {'x': 0, 'y': 0, 'z': 0}, 'left_hand_landmarks': []}
latest_ball_data = {'balls': []}
bigtrack_state = {'x': 0.0, 'y': 0.0, 'left_button': False, 'right_button': False, 'left_click': False, 'right_click': False}

hand_data_lock, ball_data_lock, frame_lock = threading.Lock(), threading.Lock(), threading.Lock()
current_frame, display_frame = None, None
last_ball_positions = {}
position_smoothing, FRAME_SKIP_HAND, FRAME_SKIP_BALL, frame_counter = 0.7, 2, 2, 0
POSITION_THRESHOLD, last_sent_hand_data, last_sent_ball_data = 0.02, None, None
SENSITIVITY, MAX_VALUE = 0.005, 1.0

# ===== BIGTRACK =====
def read_bigtrack():
    global bigtrack_state
    try:
        backend = usb.backend.libusb1.get_backend(find_library=lambda x: os.path.join(os.path.dirname(__file__), "libusb-1.0.dll"))
        dev = usb.core.find(idVendor=0x2046, idProduct=0x0126, backend=backend)
        if not dev:
            return
        dev.set_configuration()
        ep = usb.util.find_descriptor(dev.get_active_configuration()[(0,0)], 
                                       custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN)
        last_left = last_right = False
        while True:
            try:
                data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize, timeout=1000)
                if data:
                    buttons, dx, dy = data[0], data[1] if data[1] < 128 else data[1] - 256, data[2] if data[2] < 128 else data[2] - 256
                    bigtrack_state['x'] = max(-MAX_VALUE, min(MAX_VALUE, bigtrack_state['x'] + dx * SENSITIVITY))
                    bigtrack_state['y'] = max(-MAX_VALUE, min(MAX_VALUE, bigtrack_state['y'] - dy * SENSITIVITY))
                    curr_left, curr_right = bool(buttons & 0x01), bool(buttons & 0x02)
                    bigtrack_state.update({'left_button': curr_left, 'right_button': curr_right,
                                          'left_click': curr_left and not last_left, 'right_click': curr_right and not last_right})
                    last_left, last_right = curr_left, curr_right
            except usb.core.USBError as e:
                if e.args[0] not in [110, 10060]:
                    time.sleep(0.1)
    except:
        pass

# ===== DETECTION =====
def detect_balls(frame):
    global latest_ball_data, last_ball_positions
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    h, w = frame.shape[:2]
    detected = []
    
    # Track detection changes
    global last_detection_state
    if 'last_detection_state' not in globals():
        last_detection_state = [False, False, False]
    current_state = [False, False, False]
    
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
                xn, yn = x/w, y/h
                if i in last_ball_positions:
                    lx, ly = last_ball_positions[i]
                    xn, yn = lx*position_smoothing + xn*(1-position_smoothing), ly*position_smoothing + yn*(1-position_smoothing)
                last_ball_positions[i] = (xn, yn)
                detected.append({'id': i, 'x': xn, 'y': yn, 'radius': int(r)})
                current_state[i] = True
            else:
                # Ball found but rejected by thresholds
                if not last_detection_state[i]:
                    pass
        else:
            # No contours found
            if last_detection_state[i]:
                pass
    
    # Print when detection state changes
    for i in range(NUM_BALLS):
        if current_state[i] != last_detection_state[i]:
            if current_state[i]:
                pass
            else:
                pass
    
    last_detection_state = current_state
    
    with ball_data_lock:
        latest_ball_data['balls'] = detected

def process_hand_tracking():
    global latest_hand_data, frame_counter
    while True:
        with frame_lock:
            frame = current_frame
        if frame is None or frame_counter % FRAME_SKIP_HAND != 0:
            time.sleep(0.01)
            continue
        
        results = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        right = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        left = {'detected': False, 'position': {'x':0,'y':0,'z':0}, 'landmarks': []}
        
        if results.multi_hand_landmarks and results.multi_handedness:
            for hand_lm, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
                wrist = hand_lm.landmark[mp_hands.HandLandmark.WRIST]
                lms = [{'x': lm.x, 'y': lm.y, 'z': lm.z} for lm in hand_lm.landmark]
                data = {'detected': True, 'position': {'x': wrist.x, 'y': wrist.y, 'z': wrist.z}, 'landmarks': lms}
                if handedness.classification[0].label == 'Right':
                    right = data
                else:
                    left = data
        
        with hand_data_lock:
            latest_hand_data.update({'right_hand_detected': right['detected'], 'right_hand_position': right['position'], 'right_hand_landmarks': right['landmarks'],
                                    'left_hand_detected': left['detected'], 'left_hand_position': left['position'], 'left_hand_landmarks': left['landmarks']})
        time.sleep(0.01)

def process_ball_tracking():
    global frame_counter
    while True:
        with frame_lock:
            frame = current_frame
        if frame is None or frame_counter % FRAME_SKIP_BALL != 0:
            time.sleep(0.01)
            continue
        detect_balls(frame)
        time.sleep(0.01)

def capture_frames():
    global current_frame, display_frame, frame_counter
    while True:
        ret, frame = camera.read()
        if ret:
            with frame_lock:
                current_frame = display_frame = frame.copy()
            frame_counter += 1
        time.sleep(0.001)

def generate_frames():
    while True:
        with frame_lock:
            frame = display_frame.copy() if display_frame is not None else None
        if frame is None:
            time.sleep(0.01)
            continue
        
        h, w = frame.shape[:2]
        with hand_data_lock:
            for hand, color in [('right', (0,255,0)), ('left', (255,0,0))]:
                if latest_hand_data[f'{hand}_hand_detected']:
                    p = latest_hand_data[f'{hand}_hand_position']
                    x, y = int(p['x']*w), int(p['y']*h)
                    cv2.circle(frame, (x,y), 10, color, 2)
                    cv2.putText(frame, hand.title(), (x-30,y-15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        
        with ball_data_lock:
            for ball in latest_ball_data['balls']:
                x, y = int(ball['x']*w), int(ball['y']*h)
                cv2.circle(frame, (x,y), ball['radius'], (0,255,255), 2)
                cv2.putText(frame, f"Ball {ball['id']}", (x-30,y-ball['radius']-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,255), 2)
        
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        time.sleep(0.033)

def has_changed(old, new):
    return old is None or new is None or abs(old.get('x',0)-new.get('x',0)) > POSITION_THRESHOLD or abs(old.get('y',0)-new.get('y',0)) > POSITION_THRESHOLD

def generate_hand_data():
    global last_sent_hand_data
    while True:
        with hand_data_lock:
            data = latest_hand_data.copy()
        send = last_sent_hand_data is None or \
               data['right_hand_detected'] != last_sent_hand_data['right_hand_detected'] or \
               (data['right_hand_detected'] and has_changed(last_sent_hand_data['right_hand_position'], data['right_hand_position'])) or \
               data['left_hand_detected'] != last_sent_hand_data['left_hand_detected'] or \
               (data['left_hand_detected'] and has_changed(last_sent_hand_data['left_hand_position'], data['left_hand_position']))
        if send:
            yield f"data: {json.dumps(data)}\n\n"
            last_sent_hand_data = data.copy()
        time.sleep(0.016)

def generate_ball_data():
    global last_sent_ball_data
    while True:
        with ball_data_lock:
            data = latest_ball_data.copy()
        send = last_sent_ball_data is None or len(data['balls']) != len(last_sent_ball_data.get('balls',[])) or \
               any(abs(c['x']-l['x'])>POSITION_THRESHOLD or abs(c['y']-l['y'])>POSITION_THRESHOLD 
                   for c in data['balls'] for l in last_sent_ball_data.get('balls',[]) if c['id']==l['id'])
        if send:
            yield f"data: {json.dumps(data)}\n\n"
            last_sent_ball_data = data.copy()
        time.sleep(0.016)

def generate_bigtrack_data():
    while True:
        yield f"data: {json.dumps(bigtrack_state)}\n\n"
        bigtrack_state['left_click'] = bigtrack_state['right_click'] = False
        time.sleep(0.016)

# ===== START =====
threading.Thread(target=read_bigtrack, daemon=True).start()
threading.Thread(target=capture_frames, daemon=True).start()
# threading.Thread(target=process_hand_tracking, daemon=True).start()
# threading.Thread(target=process_ball_tracking, daemon=True).start()

# ===== ROUTES =====
@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/hand_tracking')
def hand_tracking_route():
    return Response(generate_hand_data(), mimetype='text/event-stream', headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@app.route('/ball_tracking')
def ball_tracking_route():
    return Response(generate_ball_data(), mimetype='text/event-stream', headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@app.route('/bigtrack')
def bigtrack_route():
    return Response(generate_bigtrack_data(), mimetype='text/event-stream', headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@app.route('/hand_data')
def hand_data_route():
    with hand_data_lock:
        return jsonify(latest_hand_data)

@app.route('/ball_data')
def ball_data_route():
    with ball_data_lock:
        return jsonify(latest_ball_data)

@app.route('/health')
def health():
    return jsonify({'status':'ok'})

@app.route('/get-video-url', methods=['POST'])
def get_video_url():
    youtube_url = request.get_json()['url']
    
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
            
            # Try to find progressive MP4 (video + audio)
            for fmt in formats:
                if (fmt.get('ext') == 'mp4' and 
                    fmt.get('vcodec') != 'none' and 
                    fmt.get('acodec') != 'none' and
                    fmt.get('protocol') in ['https', 'http']):
                    video_url = fmt['url']
                    break
            
            # Fallback: video-only MP4
            if not video_url:
                for fmt in formats:
                    if (fmt.get('ext') == 'mp4' and 
                        fmt.get('vcodec') != 'none' and
                        fmt.get('protocol') in ['https', 'http']):
                        video_url = fmt['url']
                        break
            
            # Last resort: any URL
            if not video_url:
                video_url = info.get('url')
            
            if video_url:
                return jsonify({
                    'url': video_url,
                    'title': info.get('title'),
                    'success': True
                })
            else:
                return jsonify({
                    'error': 'Could not find streamable format',
                    'success': False
                }), 500
                
    except Exception as e:
        return jsonify({
            'error': str(e),
            'success': False
        }), 500

if __name__ == '__main__':
    print(f"\n✓ Server ready - Tracking {NUM_BALLS} balls")
    app.run(host='127.0.0.1', port=int(sys.argv[1]) if len(sys.argv)>1 else 5000, debug=False)