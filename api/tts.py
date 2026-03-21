import os
import json
import requests
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Resolve query params
        query = parse_qs(urlparse(self.path).query)
        text = query.get('text', [''])[0]
        
        if not text:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing text parameter")
            return

        # Fetch secrets from environment
        api_key = os.getenv("ELEVENLABS_API_KEY")
        voice_id = "DXFkLCBUTmvXpp2QwZjA" # Hardcoded voice ID as requested earlier
        
        # Proxy call to ElevenLabs
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json"
        }
        body = {
            "text": text,
            "model_id": "eleven_multilingual_v2"
        }

        try:
            response = requests.post(url, headers=headers, json=body, stream=True)
            self.send_response(response.status_code)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.end_headers()
            
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    self.wfile.write(chunk)
                    
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())
