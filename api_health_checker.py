import os
import asyncio
import time
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing Supabase credentials in .env")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def check_gemini_key(key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={key}"
    data = {
        "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
    }
    r = requests.post(url, json=data)
    if r.status_code == 429:
        return "Rate Limited"
    elif r.status_code == 200:
        return "Healthy"
    else:
        return f"Error {r.status_code}"

def check_openai_key(key):
    headers = {"Authorization": f"Bearer {key}"}
    url = "https://api.openai.com/v1/models"
    r = requests.get(url, headers=headers)
    if r.status_code == 429:
        return "Rate Limited"
    elif r.status_code == 200:
        return "Healthy"
    else:
        return f"Error {r.status_code}"

def update_db(key_prefix, provider, status):
    try:
        existing = supabase.table('api_keys_status').select('*').eq('key_prefix', key_prefix).execute()
        if existing.data:
            supabase.table('api_keys_status').update({'status': status, 'last_checked': 'now()'}).eq('key_prefix', key_prefix).execute()
        else:
            supabase.table('api_keys_status').insert({'key_prefix': key_prefix, 'provider': provider, 'status': status}).execute()
    except Exception as e:
        print(f"Error updating DB: {e}")

async def main():
    while True:
        print("Checking API Key Health...")
        
        # Check Gemini Keys
        gemini_keys = os.getenv("GEMINI_API_KEY", "").split(",")
        for key in gemini_keys:
            key = key.strip()
            if not key: continue
            prefix = "..." + key[-5:]
            status = check_gemini_key(key)
            update_db(prefix, "Gemini", status)
            
        # Check OpenAI Keys
        openai_keys = os.getenv("CHATGPT_API_KEY", "").split(",")
        for key in openai_keys:
            key = key.strip()
            if not key: continue
            prefix = "..." + key[-5:]
            status = check_openai_key(key)
            update_db(prefix, "OpenAI", status)
            
        print("Health check complete. Sleeping for 5 minutes.")
        await asyncio.sleep(300)

if __name__ == "__main__":
    asyncio.run(main())
