import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

reels = supabase.table("reels").select("*").eq("reel_type", "sleep").order("created_at", desc=True).execute()
if reels.data:
    for reel in reels.data:
        print(f"Cleaning duplicate/copied assets for Reel: {reel['title']} ({reel['id']})")
        # Reset image_url and video_url for non-leader scenes or purge duplicate URLs
        scenes = supabase.table("reel_scenes").select("*").eq("reel_id", reel['id']).order("scene_number").execute()
        if scenes.data:
            for sc in scenes.data:
                # Wiping copied image_url and video_url so every scene starts 100% fresh & unique
                supabase.table("reel_scenes").update({
                    "image_url": None,
                    "video_url": None,
                    "status": "pending"
                }).eq("id", sc['id']).execute()
    print("[+] Database cleaned! All scene rows are 100% independent and reset.")
