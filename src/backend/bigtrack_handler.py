import usb.core
import usb.util
import usb.backend.libusb1
import threading
import os
import asyncio
import time
from config import *

class BigTrackHandler:
    def __init__(self, websocket_handler, event_loop):
        self.websocket_handler = websocket_handler
        self.event_loop = event_loop
        self.state = {'x': 0.0, 'y': 0.0, 'left_button': False, 'right_button': False}
        self.current_line = 0
        self.current_segment = 0
        self.last_left_click_time = 0
        self.running = False
        self.thread = None
    
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
    
    def _read_bigtrack(self):
        try:
            backend = usb.backend.libusb1.get_backend(
                find_library=lambda x: os.path.join(os.path.dirname(__file__), "libusb-1.0.dll")
            )
            dev = usb.core.find(idVendor=BIGTRACK_VENDOR_ID, idProduct=BIGTRACK_PRODUCT_ID, backend=backend)
            if dev is None:
                return
            
            dev.set_configuration()
            cfg = dev.get_active_configuration()
            intf = cfg[(0, 0)]
            ep = usb.util.find_descriptor(
                intf,
                custom_match=lambda e: usb.util.endpoint_direction(e.bEndpointAddress) == usb.util.ENDPOINT_IN
            )
            
            last_left_button = False
            last_right_button = False
            
            while self.running:
                try:
                    data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize, timeout=1000)
                    if data:
                        self._process_input(data, last_left_button, last_right_button)
                        last_left_button = self.state['left_button']
                        last_right_button = self.state['right_button']
                except usb.core.USBError as e:
                    if e.args[0] not in (110, 10060):
                        time.sleep(0.1)
                except:
                    time.sleep(0.1)
        except:
            pass
    
    def _process_input(self, data, last_left_button, last_right_button):
        buttons = data[0]
        dx = data[1] if data[1] < 128 else data[1] - 256
        dy = data[2] if data[2] < 128 else data[2] - 256
        
        self.state['x'] += dx * BIGTRACK_SENSITIVITY
        self.state['y'] -= dy * BIGTRACK_SENSITIVITY * BIGTRACK_VERTICAL_MULTIPLIER
        self.state['x'] = max(-1.0, min(1.0, self.state['x']))
        self.state['y'] = max(-1.0, min(1.0, self.state['y']))
        
        if self.state['y'] > BIGTRACK_NAV_THRESHOLD:
            self._navigate_line(-1)
            self.state['y'] = 0
        elif self.state['y'] < -BIGTRACK_NAV_THRESHOLD:
            self._navigate_line(1)
            self.state['y'] = 0
        
        if self.state['x'] > BIGTRACK_NAV_THRESHOLD:
            self._navigate_segment(1)
            self.state['x'] = 0
        elif self.state['x'] < -BIGTRACK_NAV_THRESHOLD:
            self._navigate_segment(-1)
            self.state['x'] = 0
        
        current_left = bool(buttons & 0x01)
        current_right = bool(buttons & 0x02)
        self.state['left_button'] = current_left
        self.state['right_button'] = current_right
        
        if current_left and not last_left_button:
            current_time = time.time()
            if current_time - self.last_left_click_time < BIGTRACK_DOUBLE_CLICK_THRESHOLD:
                self._send_click_event('double_click')
            self.last_left_click_time = current_time
        
        if current_right and not last_right_button:
            self._send_click_event('right_click')
    
    def _navigate_line(self, direction):
        self.current_line += direction
        self._send_navigation_event('line', direction)
    
    def _navigate_segment(self, direction):
        self.current_segment += direction
        self._send_navigation_event('segment', direction)
    
    def _send_navigation_event(self, nav_type, direction):
        try:
            coro = self.websocket_handler.broadcast_message({
                'type': 'cursor_navigate',
                'nav_type': nav_type,
                'direction': direction
            })
            asyncio.run_coroutine_threadsafe(coro, self.event_loop)
        except:
            pass
    
    def _send_click_event(self, click_type):
        try:
            coro = self.websocket_handler.broadcast_message({
                'type': 'cursor_click',
                'click_type': click_type
            })
            asyncio.run_coroutine_threadsafe(coro, self.event_loop)
        except:
            pass