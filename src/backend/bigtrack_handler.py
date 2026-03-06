"""
BigTrack Foot Mouse Handler - Optional USB HID device for hands-free code navigation.
Self-contained: config constants are defined here, not in config.py.

Controls:
  Trackball Y-axis  ->  line navigation (NAV mode) OR fmy input (FM mode)
  Trackball X-axis  ->  segment navigation (NAV mode) OR fmx input (FM mode)
  Right button      ->  toggle NAV <-> FM mode
  Left double-click ->  select current segment
"""
import threading
import os
import asyncio
import time

# -- Device ------------------------------------------------------------------
VENDOR_ID  = 0x2046
PRODUCT_ID = 0x0126
USB_READ_TIMEOUT = 1000

# -- Navigation --------------------------------------------------------------
SENSITIVITY            = 0.005
VERTICAL_MULTIPLIER    = 1.5
NAV_THRESHOLD          = 0.3
MAX_POSITION           = 1.0
DOUBLE_CLICK_THRESHOLD = 0.5

# -- Param scrub -------------------------------------------------------------
# ~2.5x finer than NAV; one step fires after SCRUB_THRESHOLD accumulated movement
SCRUB_SENSITIVITY = 0.002
SCRUB_THRESHOLD   = 0.15

# Y-axis tolerance in scrub mode: much higher than NAV_THRESHOLD (0.3) so that
# small diagonal rolls don't accidentally jump lines mid-scrub.
# Raise further if still drifting (e.g. 1.5 = essentially locked).
SCRUB_Y_THRESHOLD = 0.8

# -- Foot mouse input mode ---------------------------------------------------
# Raw dx/dy multiplier sent to the client as foot_mouse_move events.
# 1.0 = one unit per raw USB tick. Tune up/down to taste.
FM_SENSITIVITY_X = 1.0
FM_SENSITIVITY_Y = 1.0


class BigTrackHandler:
    def __init__(self, websocket_handler, event_loop):
        self.websocket_handler = websocket_handler
        self.event_loop = event_loop

        self.state = {
            'x': 0.0, 'y': 0.0,
            'left_button': False, 'right_button': False,
        }

        self.current_line    = 0
        self.current_segment = 0

        # Mode: 'nav' | 'fm'  (scrub mode retired)
        self.mode              = 'nav'
        self.scrub_mode        = False   # kept for legacy compat; mirrors mode=='fm'
        self.scrub_accumulator = 0.0

        self.last_left_click_time = 0
        self.running = False
        self.thread  = None

    # -- Lifecycle ------------------------------------------------------------

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._read_bigtrack, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)

    # -- USB read loop --------------------------------------------------------

    def _read_bigtrack(self):
        try:
            import usb.core
            import usb.util
            import usb.backend.libusb1
        except ImportError:
            print("[BigTrack] pyusb not installed - foot mouse disabled")
            return

        try:
            backend = usb.backend.libusb1.get_backend(
                find_library=lambda x: os.path.join(os.path.dirname(__file__), "libusb-1.0.dll")
            )
            dev = usb.core.find(idVendor=VENDOR_ID, idProduct=PRODUCT_ID, backend=backend)
            if dev is None:
                print("[BigTrack] Device not found - foot mouse disabled")
                return

            print("[BigTrack] Device connected")
            dev.set_configuration()
            cfg  = dev.get_active_configuration()
            intf = cfg[(0, 0)]
            ep   = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress)
                                       == usb.util.ENDPOINT_IN
            )

            last_left_button  = False
            last_right_button = False

            while self.running:
                try:
                    data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize,
                                    timeout=USB_READ_TIMEOUT)
                    if data:
                        self._process_input(data, last_left_button, last_right_button)
                        last_left_button  = self.state['left_button']
                        last_right_button = self.state['right_button']
                except Exception as e:
                    err_code = getattr(e, 'args', [None])[0]
                    if err_code not in (110, 10060):   # ignore normal USB timeouts
                        time.sleep(0.1)

        except Exception as e:
            print(f"[BigTrack] Init failed: {e} - foot mouse disabled")

    # -- Input processing -----------------------------------------------------

    def _process_input(self, data, last_left_button, last_right_button):
        buttons = data[0]
        dx = data[1] if data[1] < 128 else data[1] - 256
        dy = data[2] if data[2] < 128 else data[2] - 256

        current_left  = bool(buttons & 0x01)
        current_right = bool(buttons & 0x02)
        self.state['left_button']  = current_left
        self.state['right_button'] = current_right

        # Right button press: toggle NAV <-> FM mode
        if current_right and not last_right_button:
            self.mode       = 'fm' if self.mode == 'nav' else 'nav'
            self.scrub_mode = (self.mode == 'fm')   # keep legacy flag in sync
            self.state['x'] = 0.0
            self.state['y'] = 0.0
            self._send_event({
                'type':   'scrub_mode_toggle',   # reuse existing client message
                'active': self.scrub_mode,
            })

        if self.mode == 'fm':
            # FM mode: send raw deltas directly — client accumulates into fmx/fmy.
            # Only send a message when there is actual movement to avoid noise.
            fm_dx = dx * FM_SENSITIVITY_X if dx != 0 else 0
            fm_dy = dy * FM_SENSITIVITY_Y if dy != 0 else 0
            if fm_dx != 0 or fm_dy != 0:
                self._send_event({
                    'type': 'foot_mouse_move',
                    'dx':   fm_dx,
                    'dy':   fm_dy,
                })
        else:
            # NAV mode: discretize into line/segment navigation steps
            self.state['y'] -= dy * SENSITIVITY * VERTICAL_MULTIPLIER
            self.state['y']  = max(-MAX_POSITION, min(MAX_POSITION, self.state['y']))

            if self.state['y'] > NAV_THRESHOLD:
                self._navigate('line', -1)
                self.state['y'] = 0.0
            elif self.state['y'] < -NAV_THRESHOLD:
                self._navigate('line', 1)
                self.state['y'] = 0.0

            self.state['x'] += dx * SENSITIVITY
            self.state['x']  = max(-MAX_POSITION, min(MAX_POSITION, self.state['x']))

            if self.state['x'] > NAV_THRESHOLD:
                self._navigate('segment', 1)
                self.state['x'] = 0.0
            elif self.state['x'] < -NAV_THRESHOLD:
                self._navigate('segment', -1)
                self.state['x'] = 0.0

        # Left button: double-click detection (works in any mode)
        if current_left and not last_left_button:
            now = time.time()
            if now - self.last_left_click_time < DOUBLE_CLICK_THRESHOLD:
                self._send_click('double_click')
            self.last_left_click_time = now

    # -- Outbound helpers -----------------------------------------------------

    def _navigate(self, nav_type, direction):
        if nav_type == 'line':
            self.current_line += direction
        else:
            self.current_segment += direction
        self._send_event({
            'type': 'cursor_navigate',
            'nav_type': nav_type,
            'direction': direction,
        })

    def _send_click(self, click_type):
        self._send_event({'type': 'cursor_click', 'click_type': click_type})

    def _send_event(self, msg):
        """Thread-safe broadcast to all connected WebSocket clients."""
        try:
            coro = self.websocket_handler.broadcast_message(msg)
            asyncio.run_coroutine_threadsafe(coro, self.event_loop)
        except Exception:
            pass