import os
import sys
import hashlib
import requests
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Lazy-init S3 client (avoid crashing at module load if boto3 or env vars are missing)
_s3_client = None
_s3_ready = False

def get_s3():
    global _s3_client, _s3_ready
    if _s3_ready:
        return _s3_client
    _s3_ready = True  # Only try once
    try:
        import boto3
        from botocore.exceptions import ClientError
        bucket = os.getenv("AWS_S3_BUCKET_NAME")
        if not bucket:
            print("[S3] ⚠️ AWS_S3_BUCKET_NAME not set — caching disabled")
            return None
        _s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION", "ap-southeast-1")
        )
        print(f"[S3] ✅ Client ready (bucket={bucket}, region={os.getenv('AWS_REGION')})")
        return _s3_client
    except Exception as e:
        print(f"[S3] ❌ Failed to init: {e}")
        return None

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        text = query.get('text', [''])[0]

        # Health check: visit /api/tts with no params to see status
        if not text:
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            s3 = get_s3()
            bucket = os.getenv("AWS_S3_BUCKET_NAME", "NOT SET")
            region = os.getenv("AWS_REGION", "NOT SET")
            el_key = "SET" if os.getenv("ELEVENLABS_API_KEY") else "MISSING"
            status = (
                f"=== TTS API Health Check ===\n"
                f"S3 Client:  {'READY' if s3 else 'DISABLED'}\n"
                f"Bucket:     {bucket}\n"
                f"Region:     {region}\n"
                f"ElevenLabs: {el_key}\n"
                f"Python:     {sys.version}\n"
            )
            self.wfile.write(status.encode())
            return

        print(f"\n{'='*50}")
        print(f"[TTS] New request: text='{text[:80]}...'")

        # 1. Hash text for cache key
        text_hash = hashlib.md5(text.encode('utf-8')).hexdigest()
        s3_key = f"tts/{text_hash}.mp3"
        print(f"[TTS] Hash={text_hash}, S3 key={s3_key}")

        bucket = os.getenv("AWS_S3_BUCKET_NAME")
        s3 = get_s3()

        # 2. Try S3 cache
        if s3 and bucket:
            try:
                print(f"[S3] Checking cache...")
                response = s3.get_object(Bucket=bucket, Key=s3_key)
                audio_data = response['Body'].read()
                size = len(audio_data)
                print(f"[S3] ✅ CACHE HIT! ({size} bytes)")

                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(size))
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                self.send_header('X-Cache', 'HIT')
                self.end_headers()
                self.wfile.write(audio_data)
                return
            except Exception as e:
                error_code = getattr(e, 'response', {}).get('Error', {}).get('Code', str(e))
                if error_code == "NoSuchKey":
                    print(f"[S3] 💨 CACHE MISS")
                else:
                    print(f"[S3] ⚠️ Cache check error: {error_code}")
        else:
            print(f"[S3] ⚠️ Skipping cache (s3={'yes' if s3 else 'no'}, bucket={bucket})")

        # 3. Call ElevenLabs
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            print(f"[TTS] ❌ ELEVENLABS_API_KEY not set!")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"ELEVENLABS_API_KEY not configured")
            return

        voice_id = "DXFkLCBUTmvXpp2QwZjA"
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
        headers = {"xi-api-key": api_key, "Content-Type": "application/json"}
        body = {"text": text, "model_id": "eleven_multilingual_v2"}

        try:
            print(f"[TTS] Calling ElevenLabs API...")
            response = requests.post(url, headers=headers, json=body)
            print(f"[TTS] ElevenLabs responded: status={response.status_code}, size={len(response.content)} bytes")

            if response.status_code != 200:
                print(f"[TTS] ❌ ElevenLabs error: {response.text[:200]}")
                self.send_response(response.status_code)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(response.text.encode())
                return

            audio_data = response.content

            # 4. Save to S3
            if s3 and bucket:
                try:
                    print(f"[S3] Uploading {len(audio_data)} bytes to {s3_key}...")
                    s3.put_object(Bucket=bucket, Key=s3_key, Body=audio_data, ContentType='audio/mpeg')
                    print(f"[S3] ✅ Upload complete!")
                except Exception as e:
                    print(f"[S3] ❌ Upload failed: {e}")

            # 5. Return audio
            print(f"[TTS] ✅ Returning {len(audio_data)} bytes of audio")
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(len(audio_data)))
            self.send_header('Cache-Control', 'public, max-age=3600')
            self.send_header('X-Cache', 'MISS')
            self.end_headers()
            self.wfile.write(audio_data)

        except Exception as e:
            print(f"[TTS] ❌ Exception: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(str(e).encode())
