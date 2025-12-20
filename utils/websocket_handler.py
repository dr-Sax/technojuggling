"""
WebSocket handler - manages client connections and messaging
"""
import asyncio
import json
import base64
import time
from config import *

class WebSocketHandler:
    def __init__(self, frame_processor, video_service, calibration_settings, camera_dimensions):
        self.frame_processor = frame_processor
        self.video_service = video_service
        self.calibration_settings = calibration_settings
        self.camera_width, self.camera_height, _ = camera_dimensions
        self.connected_clients = set()
    
    async def handle_client(self, websocket, path):
        """Handle individual WebSocket client connection"""
        self.connected_clients.add(websocket)
        print(f"✓ Client connected from {websocket.remote_address}")
        
        try:
            # Send initial calibration data
            await websocket.send(json.dumps({
                'type': 'calibration',
                'data': self.calibration_settings
            }))
            
            # Handle incoming messages
            async for message in websocket:
                await self._handle_message(websocket, message)
                
        except Exception as e:
            print(f"⚠️  Client error: {e}")
        finally:
            self.connected_clients.discard(websocket)
            print(f"✗ Client disconnected from {websocket.remote_address}")
    
    async def _handle_message(self, websocket, message):
        """Route incoming message to appropriate handler"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            if msg_type == 'start_stream':
                await self._handle_stream(websocket)
            elif msg_type == 'get_video_url':
                await self._handle_video_url(websocket, data)
            else:
                print(f"⚠️  Unknown message type: {msg_type}")
                
        except json.JSONDecodeError:
            print(f"⚠️  Invalid JSON from client")
    
    async def _handle_stream(self, websocket):
        """Handle video stream request"""
        print("Starting stream...")
        
        frame_count = 0
        last_stats_time = time.time()
        
        while websocket in self.connected_clients:
            # Get latest frame data
            frame_data = self.frame_processor.get_latest_frame_data()
            
            if frame_data['encoded_frame'] is None:
                await asyncio.sleep(0.01)
                continue
            
            # Encode frame as base64
            frame_b64 = base64.b64encode(frame_data['encoded_frame']).decode('utf-8')
            
            # Send combined data
            combined_data = {
                'type': 'frame',
                'frame': frame_b64,
                'width': self.camera_width,
                'height': self.camera_height,
                'hands': frame_data['hands'],
                'balls': frame_data['balls'],
                'timestamp': time.time()
            }
            
            await websocket.send(json.dumps(combined_data))
            frame_count += 1
            
            # Print stats every 2 seconds
            if time.time() - last_stats_time > 2.0:
                stats = self.frame_processor.get_performance_stats()
                
                print(f"📊 Camera: {stats['fps']:.1f} FPS | "
                      f"Stream: {frame_count/2:.1f} FPS | "
                      f"Encode: {stats['encode_time']:.1f}ms | "
                      f"Hands: {stats['hand_status']} | "
                      f"Balls: {stats['ball_count']}")
                
                frame_count = 0
                last_stats_time = time.time()
            
            # Control stream rate
            await asyncio.sleep(1.0 / TARGET_FPS)
    
    async def _handle_video_url(self, websocket, data):
        """Handle video URL fetch request"""
        youtube_url = data.get('url')
        result = await self.video_service.get_video_url(youtube_url)
        
        await websocket.send(json.dumps({
            'type': 'video_url',
            **result
        }))
    
    def get_client_count(self):
        """Get number of connected clients"""
        return len(self.connected_clients)