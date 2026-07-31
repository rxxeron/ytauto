import os
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

print("[+] Purging all active RunPod queues and Video Compilation tasks in Supabase...")

# 1. Reset all reel_scenes status
res1 = supabase.table("reel_scenes").update({
    "status": "pending"
}).in_("status", ["image_requested_local", "video_requested_local", "generating_video", "generating_image", "processing"]).execute()

print(f"  -> Reset {len(res1.data or [])} active reel scenes to 'pending'.")

# 2. Reset all reels compiling status
res2 = supabase.table("reels").update({
    "status": "pending"
}).in_("status", ["compiling_video", "processing_compilation"]).execute()

print(f"  -> Reset {len(res2.data or [])} compiling reels to 'pending'.")

# 3. Purge tts_jobs queue
res3 = supabase.table("tts_jobs").update({
    "status": "pending"
}).in_("status", ["image_requested_local", "video_requested_local"]).execute()

print(f"  -> Reset {len(res3.data or [])} tts jobs to 'pending'.")

# 4. Cancel active jobs via RunPod API if endpoint keys exist
runpod_api_key = os.getenv("RUNPOD_VIDEO_API_KEY")
endpoint_id = os.getenv("RUNPOD_VIDEO_ENDPOINT_ID")

if runpod_api_key and endpoint_id:
    try:
        url = f"https://api.runpod.ai/v2/{endpoint_id}/purge_queue"
        headers = {"Authorization": f"Bearer {runpod_api_key}"}
        r = requests.post(url, headers=headers)
        print(f"  -> RunPod Endpoint Queue Purge response: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"  -> RunPod Queue Purge Notice: {e}")

print("[+] ALL RUNPOD QUEUES AND VIDEO COMPILATIONS HAVE BEEN PURGED!")
