#!/usr/bin/env python3
"""
Async Startup Calibration - Waits for WebSocket message instead of console input
Improved visual feedback and multi-ball workflow
"""
import cv2
import numpy as np
import json
import os
import time
import asyncio
from datetime import datetime

class AsyncCalibrator:
    def __init__(self, camera, num_balls=3):
        self.camera = camera
        self.num_balls = num_balls
        self.choice_received = asyncio.Event()
        self.user_choice = None  # Will be set by WebSocket message
        
        # Read camera's actual current values
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
        
        self.brightness_factor = 1.0
        
        # Default HSV presets (wide ranges to start)
        presets = [
            {'h_min': 80, 'h_max': 100, 's_min': 80, 's_max': 255, 'v_min': 50, 'v_max': 255},
            {'h_min': 5, 'h_max': 20, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255},
            {'h_min': 25, 'h_max': 35, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255}
        ]
        self.hsv_ranges = {int(i): presets[i].copy() if i < len(presets) else 
                          {'h_min': 0, 'h_max': 179, 's_min': 50, 's_max': 255, 'v_min': 50, 'v_max': 255}
                          for i in range(num_balls)}
        
        # Try to load last calibration
        self.load_last()
    
    def load_last(self):
        """Load last calibration from JSON file"""
        calibration_file = os.path.join(os.path.dirname(__file__), 'last_calibration.json')
        if os.path.exists(calibration_file):
            try:
                with open(calibration_file) as f:
                    d = json.load(f)
                    self.camera_settings = d.get('camera_settings', self.camera_settings)
                    for k, v in d.get('hsv_ranges', {}).items():
                        self.hsv_ranges[int(k)] = v
                print("  Loaded last calibration")
            except Exception as e:
                print(f"  Could not load last calibration: {e}")
    
    def save(self):
        """Save calibration to JSON file"""
        calibration_file = os.path.join(os.path.dirname(__file__), 'last_calibration.json')
        with open(calibration_file, 'w') as f:
            json.dump({
                'camera_settings': self.camera_settings,
                'hsv_ranges': {str(k): v for k, v in self.hsv_ranges.items()},
                'timestamp': datetime.now().isoformat()
            }, f)
        print("  Saved calibration")
    
    def apply_cam(self):
        """Apply camera settings"""
        try:
            # Flush camera buffer
            for _ in range(5):
                self.camera.read()
            time.sleep(0.3)
        except:
            pass
        
        # Apply settings
        for k, v in [('BRIGHTNESS', 'brightness'), ('CONTRAST', 'contrast'), 
                     ('SATURATION', 'saturation'), ('AUTO_EXPOSURE', 1), 
                     ('EXPOSURE', 'exposure'), ('GAIN', 'gain')]:
            self.camera.set(
                getattr(cv2, f'CAP_PROP_{k}'),
                v if isinstance(v, int) else self.camera_settings[v]
            )
        
        time.sleep(0.3)
        
        # Read back actual applied values
        self.camera_settings['brightness'] = int(self.camera.get(cv2.CAP_PROP_BRIGHTNESS))
        self.camera_settings['contrast'] = int(self.camera.get(cv2.CAP_PROP_CONTRAST))
        self.camera_settings['saturation'] = int(self.camera.get(cv2.CAP_PROP_SATURATION))
        self.camera_settings['exposure'] = int(self.camera.get(cv2.CAP_PROP_EXPOSURE))
        self.camera_settings['gain'] = int(self.camera.get(cv2.CAP_PROP_GAIN))
    
    def set_choice(self, use_last):
        """Called by WebSocket handler when user makes choice"""
        self.user_choice = 'use_last' if use_last else 'calibrate'
        self.choice_received.set()
        print(f"  Calibration choice received: {self.user_choice}")
    
    async def wait_for_choice(self):
        """Wait for user choice from WebSocket"""
        print("  Waiting for calibration choice from client...")
        await self.choice_received.wait()
        return self.user_choice
    
    def _auto_calculate_range(self, picks):
        """Calculate HSV range from picked points"""
        h_vals = [p['h'] for p in picks]
        s_vals = [p['s'] for p in picks]
        v_vals = [p['v'] for p in picks]
        
        return {
            'h_min': max(0, min(h_vals) - 10),
            'h_max': min(179, max(h_vals) + 10),
            's_min': max(0, min(s_vals) - 30),
            's_max': min(255, max(s_vals) + 30),
            'v_min': max(0, min(v_vals) - 40),
            'v_max': min(255, max(v_vals) + 40)
        }
    
    def calibrate_balls_interactive(self):
        """Interactive ball calibration with improved visual feedback"""
        print("  Starting interactive calibration...")
        print("  Two windows will open:")
        print("    - 'Camera Feed': Click on balls to select color points")
        print("    - 'Tracking Preview': Shows detected blobs in white")
        print()
        
        cv2.namedWindow("Camera Feed")
        cv2.namedWindow("Tracking Preview")
        
        # Calibrate each ball
        for bid in range(self.num_balls):
            r = self.hsv_ranges[bid]
            picks = []
            click_positions = []  # Store click positions for visual feedback
            finished_early = False
            
            print(f"\n  === Calibrating ball {bid + 1}/{self.num_balls} ===")
            print("    - CLICK on the ball multiple times")
            print("    - Preview updates automatically as you click")
            print("    - Press 'a' to manually recalculate HSV range")
            print("    - Press ENTER to save and move to next ball")
            print("    - Press 'c' to clear all clicks and start over")
            print("    - Press ESC to finish calibration and save")
            
            def mouse_callback(event, x, y, flags, param):
                if event == cv2.EVENT_LBUTTONDOWN:
                    ret, frame = self.camera.read()
                    if ret:
                        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                        h, s, v = hsv[y, x]
                        picks.append({'h': int(h), 's': int(s), 'v': int(v)})
                        click_positions.append((x, y))
                        print(f"      Click {len(picks)}: H={h} S={s} V={v}")
                        
                        # Auto-update range as user clicks
                        if len(picks) >= 2:
                            new_range = self._auto_calculate_range(picks)
                            r.update(new_range)
                            print(f"      Auto-updated: H({r['h_min']}-{r['h_max']}) "
                                  f"S({r['s_min']}-{r['s_max']}) V({r['v_min']}-{r['v_max']})")
            
            cv2.setMouseCallback("Camera Feed", mouse_callback)
            
            # Main calibration loop for this ball
            while True:
                ret, frame = self.camera.read()
                if not ret:
                    break
                
                # Make a copy for drawing
                display_frame = frame.copy()
                
                # Draw green dots where user clicked
                for pos in click_positions:
                    cv2.circle(display_frame, pos, 8, (0, 255, 0), -1)
                    cv2.circle(display_frame, pos, 10, (255, 255, 255), 2)
                
                # Convert to HSV for mask
                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                
                # Create mask using current range
                mask = cv2.inRange(hsv, 
                                  np.array([r['h_min'], r['s_min'], r['v_min']]),
                                  np.array([r['h_max'], r['s_max'], r['v_max']]))
                mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
                mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
                
                # Show instructions on camera feed
                cv2.putText(display_frame, f"Ball {bid + 1}/{self.num_balls} - Clicks: {len(picks)}", 
                           (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.putText(display_frame, "CLICK ball | 'a'=recalc | ENTER=next | 'c'=clear | ESC=finish", 
                           (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
                
                # Show current HSV range
                info_text = f"H:{r['h_min']}-{r['h_max']} S:{r['s_min']}-{r['s_max']} V:{r['v_min']}-{r['v_max']}"
                cv2.putText(display_frame, info_text, 
                           (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1)
                
                # Display windows
                cv2.imshow("Camera Feed", display_frame)
                cv2.imshow("Tracking Preview", mask)
                
                key = cv2.waitKey(1) & 0xFF
                
                if key == 27:  # ESC - finish calibration completely
                    print(f"      Finished calibration at ball {bid + 1}/{self.num_balls}")
                    finished_early = True
                    break
                    
                elif key in [13, 10]:  # ENTER - next ball
                    if len(picks) >= 2:
                        print(f"      Ball {bid + 1} saved with {len(picks)} clicks")
                        break  # Exit inner while loop, continue to next ball in for loop
                    else:
                        print("      Need at least 2 clicks before moving to next ball")
                        
                elif key == ord('a'):  # Manual recalculate
                    if len(picks) >= 2:
                        new_range = self._auto_calculate_range(picks)
                        r.update(new_range)
                        print(f"      Recalculated: H({r['h_min']}-{r['h_max']}) "
                              f"S({r['s_min']}-{r['s_max']}) V({r['v_min']}-{r['v_max']})")
                    else:
                        print("      Need at least 2 clicks for recalculation")
                        
                elif key == ord('c'):  # Clear picks
                    picks = []
                    click_positions = []
                    # Reset to default range
                    presets = [
                        {'h_min': 80, 'h_max': 100, 's_min': 80, 's_max': 255, 'v_min': 50, 'v_max': 255},
                        {'h_min': 5, 'h_max': 20, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255},
                        {'h_min': 25, 'h_max': 35, 's_min': 100, 's_max': 255, 'v_min': 80, 'v_max': 255}
                    ]
                    if bid < len(presets):
                        r.update(presets[bid])
                    print("      Cleared all clicks and reset range")
            
            # If user pressed ESC, break out of for loop too
            if finished_early:
                break
        
        cv2.destroyAllWindows()
        self.save()
        print(f"\n  Calibration complete! Saved settings for all balls")
        return True
    
    async def quick_calibrate(self):
        """Wait for WebSocket choice and calibrate accordingly"""
        print("\n" + "=" * 60)
        print("STARTUP CALIBRATION")
        print("=" * 60)
        
        # Wait for choice from WebSocket
        choice = await self.wait_for_choice()
        
        if choice == 'use_last':
            print("  Using last settings")
            self.apply_cam()
            return True
        
        elif choice == 'calibrate':
            print("  Starting full calibration")
            self.calibrate_balls_interactive()
            return True
        
        return False
    
    def get_settings(self):
        """Get calibration settings"""
        return {
            'camera_settings': self.camera_settings,
            'hsv_ranges': self.hsv_ranges
        }

# Global calibrator instance
_calibrator = None

def create_calibrator(camera, num_balls=3):
    """Create calibrator instance"""
    global _calibrator
    _calibrator = AsyncCalibrator(camera, num_balls)
    return _calibrator

def set_calibration_choice(use_last):
    """Set calibration choice (called by WebSocket handler)"""
    global _calibrator
    if _calibrator:
        _calibrator.set_choice(use_last)

async def run_async_calibration(camera, num_balls=3):
    """Run async calibration"""
    calibrator = create_calibrator(camera, num_balls)
    success = await calibrator.quick_calibrate()
    return calibrator.get_settings() if success else None