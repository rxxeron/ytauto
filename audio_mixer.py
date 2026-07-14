import os
import requests
import json
import time
import requests
import asyncio
from pydub import AudioSegment
from dotenv import load_dotenv
from supabase import create_client, Client
from google import genai
from google.genai import types

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def upload_to_media_bucket(local_path, destination_path, content_type):
    try:
        with open(local_path, "rb") as f:
            # Overwrite if exists
            supabase.storage.from_("media").upload(
                path=destination_path,
                file=f,
                file_options={"content-type": content_type, "x-upsert": "true"}
            )
        return supabase.storage.from_("media").get_public_url(destination_path)
    except Exception as e:
        print(f"[-] Supabase Storage Upload Error: {e}")
        # Return fallback local path just in case
        return f"/assets/{destination_path}"

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

# Get random Gemini key
api_keys = os.getenv("GEMINI_API_KEY", "").split(",")
gemini_client = genai.Client(api_key=api_keys[0]) if api_keys[0] else None

# Configure FFMPEG path if in current dir
os.environ["PATH"] += os.pathsep + os.path.abspath(os.getcwd())

VOICE_MAP = {
    "maya": "EXAVITQu4vr4xnSDxMaL", 
    "narrator": "JBFqnCBsd6RMkjVDRZzb", 
    "default": "JBFqnCBsd6RMkjVDRZzb"
}

def generate_edl(scenes):
    print("  -> Asking Gemini to generate Audio EDL (Edit Decision List)...")
    prompt = """
    You are an expert Audio Director.
    Given this sequence of scenes, generate a JSON object containing:
    1. "bgm_keyword": A youtube search phrase for a copyright-free background track that fits this story's genre (e.g. "copyright free epic cinematic music short", "no copyright lofi chill hop", "royalty free suspenseful thriller").
    2. "timeline": A JSON array of the timeline nodes.
    
    The timeline must contain the following node types:
    - {"type": "silence", "duration_seconds": float} -> Used for pacing between dialogue based on the script's emotional context.
    - {"type": "voice", "scene_id": string, "dialogue": string, "character_name": string, "voice": string} -> The voice line.
    
    Do NOT output Markdown. Just output the raw JSON object.
    """
    
    scenes_data = []
    for s in scenes:
        scenes_data.append({
            "scene_id": s["id"],
            "scene_number": s["scene_number"],
            "character_name": s["character_name"],
            "emotion_tag": s["emotion_tag"],
            "voice": s.get("voice", "en-US-GuyNeural"),
            "dialogue": s["dialogue"]
        })
        
    prompt += "\n\nSCENES JSON:\n" + json.dumps(scenes_data, indent=2)
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        print("  -> Gemini response received!")
        raw = response.text.strip()
        data = json.loads(raw)
        
        # Handle fallback if Gemini returns an array by mistake
        if isinstance(data, list):
            return data, "copyright free cinematic background music"
            
        return data.get("timeline", []), data.get("bgm_keyword", "copyright free cinematic background music")
    except Exception as e:
        print(f"  -> Gemini Error in EDL generation: {e}")
        return [], "copyright free cinematic background music" 

def generate_episode_edl(scenes):
    print("  -> Asking Gemini to generate Episode Audio EDL and MusicGen Prompt...")
    prompt = """
    You are an expert Audio Director.
    Given this sequence of scenes, generate a JSON object containing:
    1. "musicgen_prompt": A highly descriptive music prompt for an AI music generator (like MusicGen). Describe the genre, instruments, tempo, and mood. e.g. "80s driving pop synth-wave with a fast tempo, 120bpm", "epic orchestral cinematic battle music with heavy brass and fast strings".
    2. "timeline": A JSON array of the timeline nodes.
    
    The timeline must contain the following node types:
    - {"type": "silence", "duration_seconds": float} -> Used for pacing between dialogue based on the script's emotional context.
    - {"type": "voice", "scene_id": string, "dialogue": string, "character_name": string, "voice": string} -> The voice line.
    
    Do NOT output Markdown. Just output the raw JSON object.
    """
    
    scenes_data = []
    for s in scenes:
        scenes_data.append({
            "scene_id": s["id"],
            "scene_number": s["scene_number"],
            "character_name": s["character_name"],
            "emotion_tag": s["emotion_tag"],
            "voice": s.get("voice", "en-US-GuyNeural"),
            "dialogue": s["dialogue"]
        })
        
    prompt += "\n\nSCENES JSON:\n" + json.dumps(scenes_data, indent=2)
    
    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        print("  -> Gemini response received!")
        raw = response.text.strip()
        data = json.loads(raw)
        
        if isinstance(data, list):
            return data, "ambient cinematic background music"
            
        return data.get("timeline", []), data.get("musicgen_prompt", "ambient cinematic background music")
    except Exception as e:
        print(f"  -> Gemini Error in EDL generation: {e}")
        return [], "ambient cinematic background music"

import edge_tts
import tempfile
import wave
import io
import base64

def pcm_to_mp3_bytes(pcm_bytes, sample_rate=24000, num_channels=1, sampwidth=2):
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(sampwidth)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    wav_io.seek(0)
    from pydub import AudioSegment
    seg = AudioSegment.from_wav(wav_io)
    mp3_io = io.BytesIO()
    seg.export(mp3_io, format="mp3")
    return mp3_io.getvalue()

async def generate_voice(node):
    ntype = node.get("type")
    if ntype != "voice":
        return node
        
    char_name = node.get("character_name", "").lower()
    dialogue = node.get("dialogue", "")
    
    import re
    # Remove bracketed text like [Scene 1], [Narrator]:, or [Narrator]
    clean_dialogue = re.sub(r'\[.*?\]:?\s*', '', dialogue)
    # Also strip out literal quotation marks to prevent weird TTS inflection
    clean_dialogue = clean_dialogue.replace('"', '').replace('\"', '').strip()
    
    voice = node.get("voice", "en-US-GuyNeural")
            
    kokoro_voice = voice.replace("kokoro_", "") if voice.startswith("kokoro_") else "af_bella"
    
    import os
    scene_id = node.get("scene_id")
    if scene_id:
        local_path = f"local_cache/assets/audio/chunk_{scene_id}.mp3"
        if os.path.exists(local_path):
            print(f"  -> Found existing audio chunk for {char_name} (Scene: {scene_id}). Skipping RunPod generation!")
            with open(local_path, "rb") as f:
                node['audio_bytes'] = f.read()
            return node
            
    try:
        print(f"  -> Fetching Kokoro TTS via RunPod for {char_name} (Voice: {kokoro_voice})")
        runpod_key = os.getenv("RUNPOD_API_KEY")
        runpod_endpoint = os.getenv("RUNPOD_KOKORO_ENDPOINT_ID")
        
        if not runpod_endpoint:
            print("Missing RUNPOD_KOKORO_ENDPOINT_ID in .env")
            node['audio_bytes'] = None
            return node
            
        if "." in runpod_endpoint:
            url = f"http://{runpod_endpoint}/v1/audio/speech"
            headers = {
                "Content-Type": "application/json"
            }
            payload = {
                "model": "kokoro",
                "input": clean_dialogue,
                "voice": kokoro_voice,
                "response_format": "mp3",
                "speed": 1.0
            }
            import requests
            r = requests.post(url, headers=headers, json=payload)
            if r.status_code == 200:
                node['audio_bytes'] = r.content
            else:
                print("RunPod FastAPI error:", r.status_code, r.text)
                node['audio_bytes'] = None
        else:
            url = f"https://api.runpod.ai/v2/{runpod_endpoint}/runsync"
            headers = {
                "Authorization": f"Bearer {runpod_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "input": {
                    "text": clean_dialogue,
                    "voice": kokoro_voice,
                    "speed": 1.0
                }
            }
            import requests
            import base64
            import time
            r = requests.post(url, headers=headers, json=payload)
            if r.status_code == 200:
                data = r.json()
                
                # Handle async polling if it was pushed to queue (like during cold start)
                job_id = data.get('id')
                while data.get('status') in ['IN_QUEUE', 'IN_PROGRESS']:
                    time.sleep(2)
                    status_url = f"https://api.runpod.ai/v2/{runpod_endpoint}/status/{job_id}"
                    r_status = requests.get(status_url, headers=headers)
                    if r_status.status_code == 200:
                        data = r_status.json()
                    else:
                        break

                if data.get('status') == 'COMPLETED':
                    audio_base64 = data['output']['audio_base64']
                    node['audio_bytes'] = base64.b64decode(audio_base64)
                else:
                    print("RunPod Serverless error:", data)
                    node['audio_bytes'] = None
            else:
                print("RunPod API error:", r.status_code, r.text)
                node['audio_bytes'] = None
    except Exception as e:
        print(f"Kokoro RunPod exception: {e}")
        node['audio_bytes'] = None
        
    return node

async def process_master_audio(ep_id):
    print(f"\n[+] Starting AI Audio Mixer for Episode: {ep_id} (Using Free Edge TTS & MusicGen BGM)")
    
    res = supabase.table("episode_scenes").select("*").eq("episode_id", ep_id).order("scene_number").execute()
    scenes = res.data
    
    edl, musicgen_prompt = generate_episode_edl(scenes)
    print(f"  -> Generated EDL with {len(edl)} tracks. Fetching audio in parallel...")
    
    # Save the prompt to DB
    supabase.table("episodes").update({"bgm_prompt": musicgen_prompt}).eq("id", ep_id).execute()
    
    # Fetch voices in parallel using asyncio
    tasks = [generate_edge_voice(node) for node in edl]
    edl = await asyncio.gather(*tasks)
        
    print("  -> All audio fetched. Commencing Mixdown...")
    master_track = AudioSegment.silent(duration=0) # 0ms start
    
    for i, node in enumerate(edl):
        ntype = node.get("type")
        if ntype == "silence":
            dur_ms = int(node.get("duration_seconds", 1.0) * 1000)
            master_track += AudioSegment.silent(duration=dur_ms)
            print(f"  [{i}] Added {dur_ms}ms of silence.")
            
        elif ntype == "voice":
            print(f"  [{i}] Mixing voice for {node.get('character_name')}: {node.get('dialogue')[:20]}...")
            audio_bytes = node.get('audio_bytes')
            if audio_bytes:
                temp_voice_path = f"temp_{ep_id}_{i}.mp3"
                with open(temp_voice_path, "wb") as f:
                    f.write(audio_bytes)
                segment = AudioSegment.from_mp3(temp_voice_path)
                master_track += segment
                os.remove(temp_voice_path)

    # Now handle BGM Generation via Hugging Face MusicGen API
    HF_TOKEN = os.getenv("HUGGINGFACE_API_KEY")
    bgm_path = None
    if HF_TOKEN:
        print(f"  -> Generating MusicGen BGM using prompt: '{musicgen_prompt}'")
        API_URL = "https://api-inference.huggingface.co/models/facebook/musicgen-small"
        headers = {"Authorization": f"Bearer {HF_TOKEN}"}
        temp_bgm_path = f"local_cache/assets/audio/ep_{ep_id}_bgm_temp.wav"
        
        try:
            r = requests.post(API_URL, headers=headers, json={"inputs": musicgen_prompt}, timeout=60)
            if r.status_code == 200:
                with open(temp_bgm_path, "wb") as f:
                    f.write(r.content)
                bgm_path = temp_bgm_path
                print("  [+] MusicGen BGM successfully downloaded!")
                # Save URL to DB
                supabase.table("episodes").update({"bgm_url": f"/assets/audio/ep_{ep_id}_bgm_temp.wav"}).eq("id", ep_id).execute()
            else:
                print(f"  [-] MusicGen API failed (Status {r.status_code}): {r.text}")
        except Exception as e:
            print(f"  [-] MusicGen Request failed: {e}")
    else:
        print("  [-] No HUGGINGFACE_API_KEY found. Skipping BGM generation.")

    if bgm_path and os.path.exists(bgm_path):
        try:
            bgm = AudioSegment.from_file(bgm_path)
            if len(bgm) < len(master_track):
                bgm = bgm * (len(master_track) // len(bgm) + 1)
            bgm = bgm[:len(master_track)]
            bgm = bgm - 12 # Reduce volume significantly for background
            bgm = bgm.fade_in(2000).fade_out(2000)
            master_track = master_track.overlay(bgm)
        except Exception as e:
            print(f"  [-] Failed to overlay BGM: {e}")

    # Save the final mix as MP3
    os.makedirs("local_cache/assets/audio", exist_ok=True)
    file_path = f"local_cache/assets/audio/{ep_id}_master.mp3"
    master_track.export(file_path, format="mp3")

    public_url = upload_to_media_bucket(file_path, f"audio/{ep_id}_master.mp3", "audio/mpeg")
    supabase.table("episodes").update({"status": "audio_ready", "master_audio_url": public_url}).eq("id", ep_id).execute()
    print(f"[+] Master Track successfully mixed to {public_url}")

async def process_reel_master_audio(reel_id):
    print(f"\n[+] Starting AI Audio Mixer for Reel: {reel_id} (Using Kokoro Serverless)")
    
    res = supabase.table("reel_scenes").select("*").eq("reel_id", reel_id).order("scene_number").execute()
    scenes = res.data
    
    edl, bgm_keyword = generate_edl(scenes)
    print(f"  -> Generated EDL with {len(edl)} tracks. Fetching audio in parallel...")
    
    # Fetch voices in parallel using asyncio
    tasks = [generate_voice(node) for node in edl]
    edl = await asyncio.gather(*tasks)
        
    print("  -> All audio fetched. Commencing Mixdown...")
    master_track = AudioSegment.silent(duration=0) # 0ms start
    
    timing_map = []
    current_time_ms = 0
    
    for i, node in enumerate(edl):
        ntype = node.get("type")
        if ntype == "silence":
            dur_ms = int(node.get("duration_seconds", 1.0) * 1000)
            master_track += AudioSegment.silent(duration=dur_ms)
            current_time_ms += dur_ms
            print(f"  [{i}] Added {dur_ms}ms of silence.")
            
        elif ntype == "voice":
            print(f"  [{i}] Mixing voice for {node.get('character_name')}: {node.get('dialogue')[:20]}...")
            audio_bytes = node.get('audio_bytes')
            if audio_bytes:
                scene_id = node.get('scene_id')
                
                if scene_id:
                    # Save permanently for frontend to play
                    os.makedirs("local_cache/assets/audio", exist_ok=True)
                    chunk_path = f"local_cache/assets/audio/chunk_{scene_id}.mp3"
                    with open(chunk_path, "wb") as f:
                        f.write(audio_bytes)
                    
                    storage_path = f"audio/chunk_{scene_id}.mp3"
                    supabase.storage.from_("media").upload(storage_path, audio_bytes, {"content-type": "audio/mpeg", "upsert": "true"})
                    public_url = supabase.storage.from_("media").get_public_url(storage_path)
                    
                    import time
                    public_url = f"{public_url}?t={int(time.time())}"
                    
                    # Update database so UI can show it instantly
                    supabase.table("reel_scenes").update({"audio_url": public_url, "status": "audio_ready"}).eq("id", scene_id).execute()
                    
                    segment = AudioSegment.from_mp3(chunk_path)
                else:
                    # Fallback if no scene_id
                    temp_voice_path = f"temp_{reel_id}_{i}.mp3"
                    with open(temp_voice_path, "wb") as f:
                        f.write(audio_bytes)
                    segment = AudioSegment.from_mp3(temp_voice_path)
                    os.remove(temp_voice_path)

                master_track += segment
                dur_ms = len(segment)
                
                if scene_id:
                    timing_map.append({
                        "scene_id": scene_id,
                        "scene_number": node.get('scene_number'),
                        "dialogue": node.get('dialogue'),
                        "start_ms": current_time_ms,
                        "end_ms": current_time_ms + dur_ms
                    })
                
                current_time_ms += dur_ms
                
    # Save the voice-only mix as MP3
    os.makedirs("local_cache/assets/audio", exist_ok=True)
    voice_path = f"local_cache/assets/audio/reel_{reel_id}_voice.mp3"
    master_track.export(voice_path, format="mp3")
    
    # Save the timing map for the video compiler
    timing_path = f"local_cache/assets/audio/reel_{reel_id}_timing.json"
    with open(timing_path, "w") as f:
        json.dump(timing_map, f)
        
    # Fetch BGM Options (3 options)
    print(f"  -> Fetching BGM options using keyword: '{bgm_keyword}'")
    bgm_options = []
    try:
        import subprocess
        cmd = [
            "python", "-m", "yt_dlp",
            f"ytsearch3:{bgm_keyword} no copyright",
            "--dump-json"
        ]
        result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        for line in result.stdout.strip().split('\n'):
            if not line.strip(): continue
            try:
                data = json.loads(line)
                bgm_options.append({
                    "title": data.get("title"),
                    "url": data.get("webpage_url"),
                    "duration": data.get("duration")
                })
            except json.JSONDecodeError:
                pass
    except Exception as e:
        print(f"  [-] Failed to fetch BGM options: {e}")
        
    if not bgm_options:
        # Fallback options
        bgm_options = [
            {"title": "Epic Cinematic (Fallback)", "url": "https://www.youtube.com/watch?v=kYJt2x_23bI", "duration": 180},
            {"title": "Emotional Piano (Fallback)", "url": "https://www.youtube.com/watch?v=FjNdYp2gXRY", "duration": 200},
            {"title": "Intense Thriller (Fallback)", "url": "https://www.youtube.com/watch?v=XvG2KbbD-i4", "duration": 150}
        ]
    
    supabase.table("reels").update({
        "status": "bgm_selection", 
        "bgm_options": bgm_options
    }).eq("id", reel_id).execute()
    print(f"[+] Voice Track successfully mixed. Waiting for BGM Selection.")

async def apply_bgm(reel_id):
    print(f"\n[+] Applying Selected BGM for Reel: {reel_id}")
    
    res = supabase.table("reels").select("*").eq("id", reel_id).single().execute()
    if not res.data: return
    reel = res.data
    
    voice_path = f"local_cache/assets/audio/reel_{reel_id}_voice.mp3"
    master_path = f"local_cache/assets/audio/reel_{reel_id}_master.mp3"
    
    if not os.path.exists(voice_path):
        print("[-] Voice track not found!")
        return
        
    master_track = AudioSegment.from_mp3(voice_path)
    
    selected_bgm = reel.get("selected_bgm")
    bgm_volume = float(reel.get("bgm_volume") or -6)
    
    # Try parsing bgm_start_time (MM:SS) to seconds
    start_time_str = reel.get("bgm_start_time") or "00:00"
    try:
        parts = start_time_str.split(":")
        start_seconds = int(parts[0]) * 60 + int(parts[1])
    except:
        start_seconds = 0
        
    if selected_bgm:
        print(f"  -> Downloading Selected BGM: {selected_bgm}")
        temp_bgm = f"temp_bgm_{reel_id}.mp3"
        try:
            import subprocess
            
            end_seconds = start_seconds + (len(master_track) / 1000.0) + 5.0 # buffer
            
            def format_time(seconds):
                h = int(seconds // 3600)
                m = int((seconds % 3600) // 60)
                s = int(seconds % 60)
                return f"{h:02d}:{m:02d}:{s:02d}"
                
            start_fmt = format_time(start_seconds)
            end_fmt = format_time(end_seconds)
            
            cmd = [
                "python", "-m", "yt_dlp",
                selected_bgm,
                "--download-sections", f"*{start_fmt}-{end_fmt}",
                "-x", "--audio-format", "mp3",
                "-o", temp_bgm
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            bgm = AudioSegment.from_mp3(temp_bgm)
            if len(bgm) < len(master_track):
                bgm = bgm * (len(master_track) // len(bgm) + 1)
            bgm = bgm[:len(master_track)]
            bgm = bgm + bgm_volume
            bgm = bgm.fade_in(3500).fade_out(3500)
            master_track = master_track.overlay(bgm)
            if os.path.exists(temp_bgm):
                os.remove(temp_bgm)
        except Exception as e:
            print(f"  [-] Failed to overlay BGM: {e}")
            
    master_track.export(master_path, format="mp3")
    public_url = upload_to_media_bucket(master_path, f"audio/reel_{reel_id}_master.mp3", "audio/mpeg")

    reel_type = reel.get("reel_type", "standard")
    if reel_type == "sleep":
        supabase.table("reels").update({
            "status": "completed", 
            "master_audio_url": public_url,
            "final_video_url": public_url
        }).eq("id", reel_id).execute()
        print(f"[+] Sleep Story Audio saved to {public_url} and marked as completed.")
    else:
        supabase.table("reels").update({
            "status": "audio_ready", 
            "master_audio_url": public_url
        }).eq("id", reel_id).execute()
        print(f"[+] Final Master Audio saved to {public_url}")


async def regenerate_reel_scene_chunk(scene):
    print(f"\n[+] Regenerating audio for reel scene: {scene['id']}")
    
    node = {
        'type': 'voice',
        'character_name': scene.get('character_name', 'Narrator'),
        'dialogue': scene.get('dialogue', ''),
        'voice': scene.get('voice', 'kokoro_af_bella'),
        'scene_id': scene['id']
    }
    
    node = await generate_voice(node)
    audio_bytes = node.get('audio_bytes')
    
    if audio_bytes:
        import os
        os.makedirs("local_cache/assets/audio", exist_ok=True)
        local_path = f"local_cache/assets/audio/chunk_{scene['id']}.mp3"
        with open(local_path, "wb") as f:
            f.write(audio_bytes)
            
        storage_path = f"audio/chunk_{scene['id']}.mp3"
        supabase.storage.from_("media").upload(storage_path, audio_bytes, {"content-type": "audio/mpeg", "upsert": "true"})
        public_url = supabase.storage.from_("media").get_public_url(storage_path)
        
        import time
        public_url = f"{public_url}?t={int(time.time())}"
        supabase.table("reel_scenes").update({"audio_url": public_url, "status": "audio_ready", "error_message": None}).eq("id", scene['id']).execute()
        
        reel_id = scene.get('reels', {}).get('id') or scene.get('reel_id')
        if reel_id:
            await rebuild_reel_master_voice(reel_id)
    else:
        supabase.table("reel_scenes").update({"status": "error"}).eq("id", scene['id']).execute()

async def rebuild_reel_master_voice(reel_id):
    print(f"  -> Rebuilding master voice track for reel {reel_id}...")
    res = supabase.table("reel_scenes").select("*").eq("reel_id", reel_id).order("scene_number").execute()
    scenes = res.data or []
    
    edl, _ = generate_edl(scenes)
    
    master_track = AudioSegment.silent(duration=0)
    current_time_ms = 0
    timing_map = []
    
    for i, node in enumerate(edl):
        ntype = node.get("type")
        if ntype == "silence":
            dur_ms = int(node.get("duration_seconds", 1.0) * 1000)
            master_track += AudioSegment.silent(duration=dur_ms)
            current_time_ms += dur_ms
            
        elif ntype == "voice":
            scene_id = node.get('scene_id')
            if scene_id:
                chunk_path = f"local_cache/assets/audio/chunk_{scene_id}.mp3"
                # Strip out query params if any
                if "?" in chunk_path: chunk_path = chunk_path.split("?")[0]
                
                if os.path.exists(chunk_path):
                    segment = AudioSegment.from_mp3(chunk_path)
                    master_track += segment
                    dur_ms = len(segment)
                    
                    timing_map.append({
                        "scene_id": scene_id,
                        "scene_number": node.get('scene_number'),
                        "dialogue": node.get('dialogue'),
                        "start_ms": current_time_ms,
                        "end_ms": current_time_ms + dur_ms
                    })
                    current_time_ms += dur_ms

    os.makedirs("local_cache/assets/audio", exist_ok=True)
    voice_path = f"local_cache/assets/audio/reel_{reel_id}_voice.mp3"
    master_track.export(voice_path, format="mp3")
    
    timing_path = f"local_cache/assets/audio/reel_{reel_id}_timing.json"
    with open(timing_path, "w") as f:
        json.dump(timing_map, f)
    
    print(f"  -> Master voice track rebuilt.")

if __name__ == "__main__":
    # Test script if run directly
    ep_res = supabase.table("episodes").select("id").eq("title", "My Journey").execute()
    if ep_res.data:
        asyncio.run(process_master_audio(ep_res.data[0]['id']))
