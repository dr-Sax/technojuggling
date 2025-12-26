"""
WebSocket handler - triggers calibration when first client connects
FIXED: Sends calibration data back to all clients after completion
"""
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
        self.camera_width, self.camera_height, _ = camera_dimensions
        self.connected_clients = set()
        self.calibration_settings = None
        self.first_connection = True
        self.on_first_connection = None  # Callback to trigger calibration
        
    def set_calibration_settings(self, settings):
        """Set calibration settings after initialization"""
        print("[HANDLER] Setting calibration settings")
        self.calibration_settings = settings
        
        # IMPORTANT: Send calibration data to all connected clients
        asyncio.create_task(self.broadcast_calibration())
    
    async def broadcast_calibration(self):
        """Send calibration data to all connected clients"""
        print(f"[HANDLER] Broadcasting calibration to {len(self.connected_clients)} clients")
        
        if not self.calibration_settings:
            print("[HANDLER] No calibration settings to broadcast!")
            return
        
        message = json.dumps({
            'type': 'calibration',
            'data': self.calibration_settings
        })
        
        # Send to all connected clients
        disconnected = set()
        for client in self.connected_clients:
            try:
                await client.send(message)
                print(f"[HANDLER] Sent calibration to {client.remote_address}")
            except Exception as e:
                print(f"[HANDLER] Failed to send to client: {e}")
                disconnected.add(client)
        
        # Remove disconnected clients
        self.connected_clients -= disconnected
    
    async def handle_client(self, websocket, path):
        """Handle individual WebSocket client connection"""
        self.connected_clients.add(websocket)
        print(f"Client connected from {websocket.remote_address}")
        
        # On first connection, trigger calibration and ask for choice
        if self.first_connection:
            self.first_connection = False
            print("First client connected - requesting calibration choice...")
            
            # Send calibration request
            await websocket.send(json.dumps({
                'type': 'calibration_request'
            }))
            
            # Trigger calibration in background (will wait for user choice)
            if self.on_first_connection:
                self.on_first_connection()
        
        try:
            # If calibration already done, send it immediately
            if self.calibration_settings is not None:
                print(f"[HANDLER] Sending existing calibration to new client")
                await websocket.send(json.dumps({
                    'type': 'calibration',
                    'data': self.calibration_settings
                }))
            
            # Create a task to handle streaming
            stream_task = None
            
            # Handle incoming messages
            async for message in websocket:
                data = json.loads(message)
                msg_type = data.get('type')
                
                print(f"[HANDLER] Received message type: {msg_type}")
                
                if msg_type == 'calibration_choice':
                    await self._handle_calibration_choice(websocket, data)
                elif msg_type == 'start_stream':
                    # Start streaming in background task
                    if stream_task is None:
                        stream_task = asyncio.create_task(self._handle_stream(websocket))
                elif msg_type == 'get_video_url':
                    print(f"[HANDLER] Handling video URL request for: {data.get('url')}")
                    await self._handle_video_url(websocket, data)
                else:
                    print(f"Unknown message type: {msg_type}")
                
        except json.JSONDecodeError:
            print(f"Invalid JSON from client")
        except Exception as e:
            print(f"Client error: {e}")
        finally:
            self.connected_clients.discard(websocket)
            if stream_task:
                stream_task.cancel()
            print(f"Client disconnected from {websocket.remote_address}")
    
    async def _handle_message(self, websocket, message):
        """Route incoming message to appropriate handler"""
        try:
            data = json.loads(message)
            msg_type = data.get('type')
            
            print(f"[HANDLER] Received message type: {msg_type}")
            
            if msg_type == 'calibration_choice':
                await self._handle_calibration_choice(websocket, data)
            elif msg_type == 'start_stream':
                await self._handle_stream(websocket)
            elif msg_type == 'get_video_url':
                print(f"[HANDLER] Handling video URL request for: {data.get('url')}")
                await self._handle_video_url(websocket, data)
            else:
                print(f"[failed]")
        except:
            pass
    
    async def _handle_calibration_choice(self, websocket, data):
        """Handle calibration choice from client"""
        use_last = data.get('use_last', True)
        print(f"Received calibration choice: {'use last' if use_last else 'calibrate now'}")
        
        # Notify calibration system
        set_calibration_choice(use_last)
        
        # Calibration will complete in background
        # When done, set_calibration_settings() will be called which broadcasts to all clients
    
    async def _handle_stream(self, websocket):
        """Handle video stream request"""
        print("[STREAM] Stream requested...")
        
        # Wait for calibration if not done yet
        timeout = 120  # 2 minutes timeout for calibration
        start_time = time.time()
        
        while self.calibration_settings is None:
            if time.time() - start_time > timeout:
                print("[STREAM] Calibration timeout!")
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Calibration timeout - please refresh and try again'
                }))
                return
            
            await asyncio.sleep(0.1)
        
        print("[STREAM] Starting stream...")
        
        frame_count = 0
        last_stats_time = time.time()
        
        while websocket in self.connected_clients:
            # Get latest frame data
            if self.frame_processor is None:
                await asyncio.sleep(0.1)
                continue
                
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
                
                print(f"Camera: {stats['fps']:.1f} FPS | "
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