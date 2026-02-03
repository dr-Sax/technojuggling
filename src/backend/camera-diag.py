#!/usr/bin/env python3
"""
Get detailed camera information
"""
import cv2
import subprocess
import re

def get_camera_details_opencv(index):
    """Get all available OpenCV properties"""
    print(f"\n{'=' * 60}")
    print(f"CAMERA INDEX {index} - OpenCV Properties")
    print(f"{'=' * 60}")
    
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    
    if not cap.isOpened():
        print("  Failed to open")
        return
    
    # Get all standard properties
    properties = {
        'Width': cv2.CAP_PROP_FRAME_WIDTH,
        'Height': cv2.CAP_PROP_FRAME_HEIGHT,
        'FPS': cv2.CAP_PROP_FPS,
        'Format': cv2.CAP_PROP_FORMAT,
        'Mode': cv2.CAP_PROP_MODE,
        'Brightness': cv2.CAP_PROP_BRIGHTNESS,
        'Contrast': cv2.CAP_PROP_CONTRAST,
        'Saturation': cv2.CAP_PROP_SATURATION,
        'Hue': cv2.CAP_PROP_HUE,
        'Gain': cv2.CAP_PROP_GAIN,
        'Exposure': cv2.CAP_PROP_EXPOSURE,
        'Backend': 'DSHOW',
    }
    
    for name, prop in properties.items():
        if name == 'Backend':
            value = cap.getBackendName()
        else:
            value = cap.get(prop)
        print(f"  {name:20}: {value}")
    
    # Get FOURCC codec
    fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
    fourcc_str = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])
    print(f"  {'Codec (FOURCC)':20}: {fourcc_str}")
    
    cap.release()

def get_camera_name_windows(index):
    """Try to get actual camera device name using PowerShell"""
    print(f"\n{'=' * 60}")
    print(f"CAMERA INDEX {index} - Windows Device Name")
    print(f"{'=' * 60}")
    
    try:
        # Use PowerShell to list video devices
        cmd = 'powershell "Get-PnpDevice -Class Camera,Image | Select-Object FriendlyName,Status | Format-List"'
        result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        
        if result.returncode == 0:
            print(result.stdout)
        else:
            print("  Could not retrieve device names via PowerShell")
    except Exception as e:
        print(f"  Error: {e}")
    
    # Also try WMI
    try:
        cmd = 'wmic path Win32_PnPEntity where "PNPClass=\'Camera\'" get Caption'
        result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
        
        if result.returncode == 0:
            print("\nWMI Camera Devices:")
            print(result.stdout)
    except Exception as e:
        print(f"  WMI Error: {e}")

def show_test_frame(index):
    """Show a test frame to visually verify camera"""
    print(f"\n{'=' * 60}")
    print(f"CAMERA INDEX {index} - Visual Test")
    print(f"{'=' * 60}")
    print("  Opening preview window...")
    print("  Press any key to close and continue")
    
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    
    if cap.isOpened():
        ret, frame = cap.read()
        if ret:
            # Add text overlay
            cv2.putText(frame, f"Camera Index: {index}", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            cv2.imshow(f"Camera {index}", frame)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
    
    cap.release()

if __name__ == '__main__':
    print("=" * 60)
    print("DETAILED CAMERA INFORMATION")
    print("=" * 60)
    
    # Test indices 6 and 9
    for idx in [3, 5]:
        get_camera_details_opencv(idx)
        show_test_frame(idx)
    
    # Get Windows device names
    print("\n" + "=" * 60)
    print("WINDOWS CAMERA DEVICES")
    print("=" * 60)
    get_camera_name_windows(0)
    
    print("\n" + "=" * 60)
    print("IDENTIFICATION TIPS")
    print("=" * 60)
    print("OBS Virtual Camera typically shows:")
    print("  - Name contains 'OBS' or 'Virtual Camera'")
    print("  - Higher resolution (1920x1080)")
    print("  - May show your OBS scene in the preview window")
    print("\nLogitech Brio typically shows:")
    print("  - Name contains 'BRIO' or 'Logitech'")
    print("  - Various resolutions available")
    print("  - Shows raw camera feed")