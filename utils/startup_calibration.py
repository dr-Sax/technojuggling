#!/usr/bin/env python3
"""Simplified Startup Calibration"""
import cv2, numpy as np, json, os, time
from datetime import datetime

class StartupCalibrator:
    def __init__(self, camera, num_balls=3):
        self.camera, self.num_balls = camera, num_balls
        
        # Read camera's ACTUAL current values instead of hardcoded defaults
        print("  Reading camera's actual settings...")
        self.camera_settings = {
            'brightness': int(self.camera.get(cv2.CAP_PROP_BRIGHTNESS)),
            'contrast': int(self.camera.get(cv2.CAP_PROP_CONTRAST)),
            'saturation': int(self.camera.get(cv2.CAP_PROP_SATURATION)),
            'exposure': int(self.camera.get(cv2.CAP_PROP_EXPOSURE)),
            'gain': int(self.camera.get(cv2.CAP_PROP_GAIN))
        }
        print(f"  Camera has: B={self.camera_settings['brightness']}, "
              f"E={self.camera_settings['exposure']}, G={self.camera_settings['gain']}")
        
        self.brightness_factor = 1.0  # For matching Three.js rendering
        presets = [
            {'h_min': 80, 'h_max': 100, 's_min': 80, 's_max': 255, 'v_min': 50, 'v_max': 255},
            {'h_min': 5, 'h_max': 20, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255},
            {'h_min': 25, 'h_max': 35, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255}
        ]
        self.hsv_ranges = {int(i): presets[i].copy() if i < len(presets) else 
                          {'h_min': 0, 'h_max': 179, 's_min': 50, 's_max': 255, 'v_min': 50, 'v_max': 255}
                          for i in range(num_balls)}
        self.load_last()
    
    def load_last(self):
        if os.path.exists('last_calibration.json'):
            try:
                with open('last_calibration.json') as f:
                    d = json.load(f)
                    self.camera_settings = d.get('camera_settings', self.camera_settings)
                    for k,v in d.get('hsv_ranges', {}).items():
                        self.hsv_ranges[int(k)] = v
            except: pass
    
    def save(self):
        with open('last_calibration.json', 'w') as f:
            json.dump({'camera_settings': self.camera_settings,
                      'hsv_ranges': {str(k):v for k,v in self.hsv_ranges.items()},
                      'timestamp': datetime.now().isoformat()}, f)
    
    def apply_cam(self):
        try:
            self.camera.set(cv2.CAP_PROP_ZOOM, 150)
            time.sleep(0.3)
            self.camera.read()
            self.camera.set(cv2.CAP_PROP_ZOOM, 100)
            time.sleep(0.3)
            self.camera.read()
        except: pass
        
        # Apply settings
        for k,v in [('BRIGHTNESS', 'brightness'), ('CONTRAST', 'contrast'), ('SATURATION', 'saturation'),
                    ('AUTO_EXPOSURE', 1), ('EXPOSURE', 'exposure'), ('GAIN', 'gain')]:
            self.camera.set(getattr(cv2, f'CAP_PROP_{k}'), v if isinstance(v, int) else self.camera_settings[v])
        
        time.sleep(0.3)
        
        # Read back what camera ACTUALLY applied (camera may reject some values)
        self.camera_settings['brightness'] = int(self.camera.get(cv2.CAP_PROP_BRIGHTNESS))
        self.camera_settings['contrast'] = int(self.camera.get(cv2.CAP_PROP_CONTRAST))
        self.camera_settings['saturation'] = int(self.camera.get(cv2.CAP_PROP_SATURATION))
        self.camera_settings['exposure'] = int(self.camera.get(cv2.CAP_PROP_EXPOSURE))
        self.camera_settings['gain'] = int(self.camera.get(cv2.CAP_PROP_GAIN))
    
    def quick_calibrate(self):
        print("\n" + "="*60 + "\nSTARTUP CALIBRATION\n" + "="*60)
        print("\n1. Use last settings\n2. Quick camera adjust\n3. Full calibration")
        choice = input("\nSelect (1-3): ").strip()
        if choice == '2': return self.cam_adjust()
        elif choice == '3': return self.full()
        self.apply_cam()
        return True
    
    def cam_adjust(self):
        cv2.namedWindow("Camera")
        self.apply_cam()
        print("\nControls: b/B=brightness, e/E=exposure, g/G=gain, ENTER=done")
        
        while True:
            ret, frame = self.camera.read()
            if not ret: break
            
            for i, (k,v) in enumerate([('Brightness', 'brightness'), ('Exposure', 'exposure'), ('Gain', 'gain')]):
                cv2.putText(frame, f"{k}: {self.camera_settings[v]}", (10,30+i*30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,0), 2)
            
            cv2.putText(frame, "Press ENTER when ready", (10,120), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,255), 2)
            
            cv2.imshow("Camera", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in [13,10]: break
            
            # Camera settings adjustment
            for c, prop, delta in [('b','brightness',-10), ('B','brightness',10), ('e','exposure',-1), 
                                   ('E','exposure',1), ('g','gain',-10), ('G','gain',10)]:
                if key == ord(c):
                    limits = {'brightness':(0,255), 'exposure':(-13,0), 'gain':(0,255)}
                    mn, mx = limits[prop]
                    self.camera_settings[prop] = max(mn, min(mx, self.camera_settings[prop] + delta))
                    self.apply_cam()
        
        cv2.destroyAllWindows()
        self.save()
        return True
    
    def full(self):
        if not self.cam_adjust(): return False
        for i in range(self.num_balls):
            print(f"\n→ Calibrating Ball {i}")
            if not self.cal_ball(int(i)): return False
        self.save()
        return True
    
    def cal_ball(self, bid):
        bid = int(bid)
        cv2.namedWindow("Camera")
        cv2.namedWindow("Mask")
        r, picks = self.hsv_ranges[bid], []
        def mouse(event, x, y, flags, hsv):
            if event == cv2.EVENT_LBUTTONDOWN and hsv is not None:
                h,s,v = hsv[y,x]
                picks.append({'h':int(h),'s':int(s),'v':int(v),'pos':(x,y)})
                print(f"  ✓ Pick #{len(picks)}: H={h} S={s} V={v}")
        cv2.setMouseCallback("Camera", mouse, None)
        print("Controls: CLICK=pick, a=auto, c=clear, ENTER=done")
        while True:
            ret, frame = self.camera.read()
            if not ret: break
            
            # Convert to HSV from ORIGINAL frame (not darkened)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            
            # Apply brightness factor ONLY for display (not for HSV sampling)
            display_frame = frame.copy()
            if self.brightness_factor != 1.0:
                display_frame = (display_frame * self.brightness_factor).astype(np.uint8)
            
            cv2.setMouseCallback("Camera", mouse, hsv)
            for i,p in enumerate(picks):
                cv2.drawMarker(display_frame, p['pos'], (0,255,0), cv2.MARKER_CROSS, 20, 2)
                cv2.circle(display_frame, p['pos'], 8, (0,255,0), 2)
                cv2.putText(display_frame, str(i+1), (p['pos'][0]+12,p['pos'][1]+5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,0), 2)
            cv2.putText(display_frame, f"Ball {bid} - Picked: {len(picks)}", (10,30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2)
            cv2.putText(display_frame, "CLICK ball, 'a'=auto, ENTER=done", (10,60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,255,255), 2)
            if self.brightness_factor != 1.0:
                cv2.putText(display_frame, f"Preview: {int(self.brightness_factor*100)}%", (10,90), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0,255,255), 1)
            
            mask = cv2.inRange(hsv, np.array([r['h_min'],r['s_min'],r['v_min']]), np.array([r['h_max'],r['s_max'],r['v_max']]))
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5,5),np.uint8))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8))
            cv2.imshow("Camera", display_frame)
            cv2.imshow("Mask", mask)
            key = cv2.waitKey(1) & 0xFF
            if key in [13,10] and len(picks) >= 2: break
            elif key == ord('a') and len(picks) >= 2:
                h,s,v = [p['h'] for p in picks], [p['s'] for p in picks], [p['v'] for p in picks]
                r.update({'h_min':max(0,min(h)-10), 'h_max':min(179,max(h)+10), 's_min':max(0,min(s)-30),
                         's_max':min(255,max(s)+30), 'v_min':max(0,min(v)-40), 'v_max':min(255,max(v)+40)})
                print(f"  ✓ Auto: H({r['h_min']}-{r['h_max']}) S({r['s_min']}-{r['s_max']}) V({r['v_min']}-{r['v_max']})")
            elif key == ord('c'): picks = []; print("  ✓ Cleared")
        cv2.destroyAllWindows()
        return True
    
    def get_settings(self):
        return {'camera_settings': self.camera_settings, 'hsv_ranges': self.hsv_ranges}

def run_startup_calibration(camera, num_balls=3):
    return StartupCalibrator(camera, num_balls).get_settings() if StartupCalibrator(camera, num_balls).quick_calibrate() else None