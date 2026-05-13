"""
WebSocket Handler - Streams frames and ball data to the frontend.

Performance optimizations:
- Frame sent as binary WebSocket message (no base64, no JSON wrapping)
- Ball data sent as separate small JSON message
- No fixed sleep between sends — sends as fast as new frames arrive

Also handles request/response messages from the frontend:
- resolve_url: resolves a YouTube URL to a direct stream URL via yt-dlp
"""
import asyncio
import json
import base64
import time
from config import *
from startup_calibration_async import set_calibration_choice
from youtube_resolver import YouTubeResolver, is_youtube_url

class WebSocketHandler:
    def __init__(self, frame_processor, camera_dimensions):
        self.frame_processor = frame_processor
        self.camera_dimensions = camera_dimensions
        self.camera_width, self.camera_height, self.actual_fps = camera_dimensions
        self.connected_clients = set()
        self.calibration_settings = None
        self.first_connection = True
        self.on_first_connection = None
        self.youtube_resolver = YouTubeResolver()
        
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
                elif msg_type == 'resolve_url':
                    # Don't block the message loop — fire and forget
                    asyncio.create_task(self._handle_resolve_url(websocket, data))
                
        except:
            pass
        finally:
            self.connected_clients.discard(websocket)
            if stream_task:
                stream_task.cancel()
    
    async def _handle_calibration_choice(self, websocket, data):
        use_last = data.get('use_last', True)
        set_calibration_choice(use_last)
    
    async def _handle_resolve_url(self, websocket, data):
        """Resolve a YouTube URL to a direct stream URL."""
        request_id = data.get('request_id')
        url = data.get('url', '')
        
        try:
            if not is_youtube_url(url):
                # Not a YouTube URL — pass it through unchanged so the frontend
                # can use this endpoint as a uniform "resolve" call
                await websocket.send(json.dumps({
                    'type': 'resolve_url_result',
                    'request_id': request_id,
                    'stream_url': url,
                    'title': '',
                    'duration': 0,
                    'video_id': '',
                }))
                return
            
            print(f"[resolver] Resolving {url}")
            result = await self.youtube_resolver.resolve(url)
            print(
                f"[resolver]   -> {result['title']!r}  "
                f"({result['duration']}s, format={result.get('format_id', '?')}, "
                f"protocol={result.get('protocol', '?')}, ext={result.get('ext', '?')})"
            )
            
            await websocket.send(json.dumps({
                'type': 'resolve_url_result',
                'request_id': request_id,
                'stream_url': result['stream_url'],
                'title': result['title'],
                'duration': result['duration'],
                'video_id': result['video_id'],
            }))
        except Exception as e:
            print(f"[resolver] ERROR resolving {url}: {e}")
            try:
                await websocket.send(json.dumps({
                    'type': 'resolve_url_error',
                    'request_id': request_id,
                    'url': url,
                    'error': str(e),
                }))
            except:
                pass
    
    async def _handle_stream(self, websocket):
        """Stream frames and ball tracking data — optimized for throughput."""
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
        last_frame_id = -1

        while websocket in self.connected_clients:
            if self.frame_processor is None:
                await asyncio.sleep(0.1)
                continue

            frame_data = self.frame_processor.get_latest_frame_data()

            if frame_data['encoded_frame'] is None or frame_data['frame_id'] == last_frame_id:
                # No new frame yet — yield briefly without sleeping a full interval.
                # asyncio.sleep(0) just hands control back to the event loop
                # and returns on the very next iteration, keeping latency minimal.
                await asyncio.sleep(0)
                continue

            last_frame_id = frame_data['frame_id']

            try:
                # Send frame as binary (no base64, no JSON overhead)
                await websocket.send(frame_data['encoded_frame'])

                # Send ball data as small JSON
                ball_msg = json.dumps({
                    'type': 'balls',
                    'balls': frame_data['balls'],
                    'frame_id': frame_data['frame_id'],
                    'timestamp': time.time()
                })
                await websocket.send(ball_msg)

                frame_count += 1
            except:
                break

            # Stats logging — no sleep here, send the next frame immediately
            now = time.time()
            if now - last_stats_time > 2.0:
                stats = self.frame_processor.get_performance_stats()
                stream_fps = frame_count / (now - last_stats_time)

                print(f"Camera: {stats['fps']:.1f} FPS | "
                      f"Stream: {stream_fps:.1f} FPS | "
                      f"Encode: {stats['encode_time']:.1f}ms | "
                      f"Balls: {stats['ball_count']}")

                frame_count = 0
                last_stats_time = now

            # Yield to event loop so other coroutines (BigTrack, calibration, etc.)
            # can run between frame sends without adding latency.
            await asyncio.sleep(0)
    
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