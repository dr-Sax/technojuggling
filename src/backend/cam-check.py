import cv2
for i in range(10):
    cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ret, frame = cap.read()
        name = cap.getBackendName()
        print(f"Index {i}: {w}x{h} read={ret} backend={name}")
        cap.release()
    else:
        print(f"Index {i}: not available")