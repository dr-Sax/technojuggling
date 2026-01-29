#!/usr/bin/env python3
"""
Camera FPS Diagnostic - Measure actual frame delivery rate
"""
import cv2
import time
from config import CAMERA_INDEX, RESOLUTION_ATTEMPTS

def test_camera_fps(backend, backend_name, width, height, target_fps):
    """Test actual FPS delivery for a specific camera configuration"""
    print(f"\nTesting {backend_name} @ {width}x{height} targeting {target_fps}fps")
    print("-" * 60)
    
    # Initialize camera
    cap = cv2.VideoCapture(CAMERA_INDEX, backend)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M','J','P','G'))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, target_fps)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    # Get reported settings
    reported_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    reported_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    reported_fps = cap.get(cv2.CAP_PROP_FPS)
    
    print(f"  Requested: {width}x{height} @ {target_fps}fps")
    print(f"  Reported:  {reported_width}x{reported_height} @ {reported_fps:.1f}fps")
    
    # Measure actual FPS over 3 seconds
    print(f"  Measuring actual FPS (3 seconds)...")
    
    frame_count = 0
    start_time = time.time()
    test_duration = 3.0
    
    # Discard first few frames to let camera stabilize
    for _ in range(10):
        cap.read()
    
    # Measure actual frame rate
    measurement_start = time.time()
    while time.time() - measurement_start < test_duration:
        ret, frame = cap.read()
        if ret:
            frame_count += 1
    
    elapsed = time.time() - measurement_start
    actual_fps = frame_count / elapsed
    
    print(f"  ACTUAL:    {actual_fps:.1f}fps ({frame_count} frames in {elapsed:.2f}s)")
    
    # Compare
    if actual_fps >= target_fps * 0.9:  # Within 10% of target
        print(f"  ✓ SUCCESS: Actual FPS matches target!")
    elif actual_fps >= reported_fps * 0.9:  # Matches reported
        print(f"  ⚠ WARNING: Actual matches reported, but below target")
    else:
        print(f"  ✗ FAIL: Actual FPS significantly below reported")
    
    cap.release()
    return {
        'backend': backend_name,
        'resolution': f"{reported_width}x{reported_height}",
        'reported_fps': reported_fps,
        'actual_fps': actual_fps,
        'success': actual_fps >= target_fps * 0.9
    }

def main():
    """Run comprehensive camera FPS diagnostics"""
    print("=" * 60)
    print("CAMERA FPS DIAGNOSTIC")
    print("=" * 60)
    
    results = []
    
    backends = [
        (cv2.CAP_MSMF, "MSMF"),
        (cv2.CAP_DSHOW, "DSHOW"),
    ]
    
    target_fps_values = [60, 90]
    
    for target_fps in target_fps_values:
        print(f"\n{'=' * 60}")
        print(f"TESTING TARGET FPS: {target_fps}")
        print(f"{'=' * 60}")
        
        for backend, backend_name in backends:
            for width, height in RESOLUTION_ATTEMPTS:
                result = test_camera_fps(backend, backend_name, width, height, target_fps)
                results.append({**result, 'target_fps': target_fps})
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY - Configurations that achieved target FPS:")
    print("=" * 60)
    
    successful = [r for r in results if r['success']]
    if successful:
        for r in successful:
            print(f"  {r['backend']:6} @ {r['resolution']:9} - "
                  f"Target: {r['target_fps']:2}fps, Actual: {r['actual_fps']:5.1f}fps ✓")
    else:
        print("  No configurations achieved target FPS")
    
    # Best option
    print("\n" + "=" * 60)
    print("RECOMMENDATION:")
    print("=" * 60)
    
    if successful:
        best = max(successful, key=lambda x: x['actual_fps'])
        print(f"  Use: {best['backend']} @ {best['resolution']}")
        print(f"  Expected FPS: {best['actual_fps']:.1f}fps")
    else:
        # Find highest actual FPS achieved
        best = max(results, key=lambda x: x['actual_fps'])
        print(f"  Best available: {best['backend']} @ {best['resolution']}")
        print(f"  Actual FPS: {best['actual_fps']:.1f}fps (below target of {best['target_fps']}fps)")

if __name__ == '__main__':
    main()