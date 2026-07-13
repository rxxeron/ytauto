import os
import time
from dotenv import load_dotenv

load_dotenv()

MOCK_MODE = os.getenv("MOCK_MODE", "True").lower() in ("true", "1", "yes")

def generate_audio(scene_id, text, voice_id):
    """
    Calls ElevenLabs API to generate audio.
    If MOCK_MODE is True, simulates the delay and returns a dummy path.
    """
    if MOCK_MODE:
        time.sleep(1) # Simulate API call
        dummy_path = f"mock_storage/audio_scene_{scene_id}.mp3"
        return {"status": "success", "file_path": dummy_path, "duration": 4.5}
        
    # TODO: Implement real ElevenLabs API logic
    return {"status": "failed", "error": "Real API not implemented yet"}

def start_runpod_job(scene_id, prompt, audio_path):
    """
    Starts a ComfyUI (Wan 2.6) job on RunPod.
    """
    if MOCK_MODE:
        time.sleep(1.5) # Simulate API call
        return {"status": "success", "job_id": f"mock_job_{scene_id}_{int(time.time())}"}
        
    # TODO: Implement real RunPod API logic
    return {"status": "failed", "error": "Real API not implemented yet"}

def check_runpod_status(job_id):
    """
    Checks the status of a RunPod rendering job.
    """
    if MOCK_MODE:
        return {"status": "COMPLETED", "video_url": f"mock_storage/video_{job_id}.mp4"}
        
    # TODO: Implement real RunPod API logic
    return {"status": "FAILED", "error": "Real API not implemented yet"}
