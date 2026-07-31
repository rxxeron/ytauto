import os
import requests
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("RUNPOD_VIDEO_API_KEY")
endpoint_id = os.getenv("RUNPOD_VIDEO_ENDPOINT_ID")

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

# RunPod v2 Serverless purge-queue endpoint
print(f"[+] Sending purge-queue request to RunPod Endpoint: {endpoint_id}...")
r1 = requests.post(f"https://api.runpod.ai/v2/{endpoint_id}/purge-queue", headers=headers)
print(f"Purge-Queue Response: {r1.status_code} - {r1.text}")

# Check endpoint health
r2 = requests.get(f"https://api.runpod.ai/v2/{endpoint_id}/health", headers=headers)
print(f"Updated Health: {r2.status_code} - {r2.text}")
