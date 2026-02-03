import asyncio
import json
import base64
import time
from config import *
from startup_calibration_async import set_calibration_choice

class WebSocketHandler:
    def __init__(self, frame_processor, video_service, camera_dimensions):
        self.frame_processor = frame_processor
        self.video_service = video_service
        self.camera_dimensions = camera_dimensions
        self.camera_width, self.camera_height, self.actual_fps = camera_dimensions
        self.connected_clients = set()
        self.calibration_settings = None
        self.first_connection = True
        self.on_first_connection = None
        
    def set_calibration_settings(self, settings):
        self.calibration_settings = settings
        asyncio.create_task(self.broadcast_calibration())
    
    async def broadcast_calibration(self):
        if not self.calibration_settings:
            return
        
        message = json.dumps({
            'type': 'calibration',
            'data': self.calibration_settings
        })
        
        disconnected = set()
        for client in self.connected_clients:
            try:
                await client.send(message)
            except:
                disconnected.add(client)
        
        self.connected_clients -= disconnected
    
    async def handle_client(self, websocket, path):
        self.connected_clients.add(websocket)
        
        if self.first_connection:
            self.first_connection = False
            await websocket.send(json.dumps({'type': 'calibration_request'}))
            if self.on_first_connection:
                self.on_first_connection()
        
        try:
            if self.calibration_settings is not None:
                await websocket.send(json.dumps({
                    'type': 'calibration',
                    'data': self.calibration_settings
                }))
            
            stream_task = None
            
            async for message in websocket:
                data = json.loads(message)
                msg_type = data.get('type')
                
                if msg_type == 'calibration_choice':
                    await self._handle_calibration_choice(websocket, data)
                elif msg_type == 'start_stream':
                    if stream_task is None:
                        stream_task = asyncio.create_task(self._handle_stream(websocket))
                elif msg_type == 'get_video_url':
                    await self._handle_video_url(websocket, data)
                
        except:
            pass
        finally:
            self.connected_clients.discard(websocket)
            if stream_task:
                stream_task.cancel()
    
    async def _handle_calibration_choice(self, websocket, data):
        use_last = data.get('use_last', True)
        set_calibration_choice(use_last)
    
    async def _handle_stream(self, websocket):
        """OPTIMIZED: Only send new frames, match camera FPS"""
        timeout = 120
        start_time = time.time()
        
        while self.calibration_settings is None:
            if time.time() - start_time > timeout:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Calibration timeout - please refresh and try again'
                }))
                return
            await asyncio.sleep(0.1)
        
        frame_count = 0
        last_stats_time = time.time()
        last_frame_id = -1  # Track last sent frame ID
        
        # Calculate sleep time based on actual camera FPS
        frame_interval = 1.0 / self.actual_fps if self.actual_fps > 0 else 1.0 / 30
        
        while websocket in self.connected_clients:
            if self.frame_processor is None:
                await asyncio.sleep(0.1)
                continue
                
            frame_data = self.frame_processor.get_latest_frame_data()
            
            # Skip if no frame or if it's the same frame we already sent
            if frame_data['encoded_frame'] is None or frame_data['frame_id'] == last_frame_id:
                await asyncio.sleep(0.001)  # Small sleep to prevent tight loop
                continue
            
            last_frame_id = frame_data['frame_id']
            
            frame_b64 = base64.b64encode(frame_data['encoded_frame']).decode('utf-8')
            
            combined_data = {
                'type': 'frame',
                'frame': frame_b64,
                'width': self.camera_width,
                'height': self.camera_height,
                'hands': frame_data['hands'],
                'balls': frame_data['balls'],
                'timestamp': time.time(),
                'frame_id': frame_data['frame_id']
            }
            
            await websocket.send(json.dumps(combined_data))
            frame_count += 1
            
            # Print stats every 2 seconds
            if time.time() - last_stats_time > 2.0:
                stats = self.frame_processor.get_performance_stats()
                stream_fps = frame_count / 2.0
                
                print(f"Camera: {stats['fps']:.1f} FPS | "
                      f"Stream: {stream_fps:.1f} FPS | "
                      f"Encode: {stats['encode_time']:.1f}ms | "
                      f"Hands: {stats['hand_status']} | "
                      f"Balls: {stats['ball_count']}")
                
                frame_count = 0
                last_stats_time = time.time()
            
            # Sleep to match camera frame rate (prevents duplicate sends)
            await asyncio.sleep(frame_interval)
    
    async def _handle_video_url(self, websocket, data):
        youtube_url = data.get('url')
        result = await self.video_service.get_video_url(youtube_url)
        
        await websocket.send(json.dumps({
            'type': 'video_url',
            **result
        }))
    
    def get_client_count(self):
        return len(self.connected_clients)
    
    async def broadcast_message(self, message_dict):
        message = json.dumps(message_dict)
        
        disconnected = set()
        for client in self.connected_clients:
            try:
                await client.send(message)
            except:
                disconnected.add(client)
        
        self.connected_clients -= disconnected