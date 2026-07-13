import os
import asyncio
import requests
import urllib.parse
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
PIXABAY_API_KEY = os.getenv("PIXABAY_API_KEY")

PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
COVERR_API_KEY = os.getenv("COVERR_API_KEY")

async def fetch_pexels_video(query):
    if not PEXELS_API_KEY: return None
    print(f"  -> Searching Pexels Videos for: '{query}'")
    try:
        url = f"https://api.pexels.com/videos/search?query={urllib.parse.quote(query)}&per_page=3&orientation=portrait"
        headers = {"Authorization": PEXELS_API_KEY}
        r = requests.get(url, headers=headers)
        data = r.json()
        
        if not data.get('videos'):
            print(f"  -> No portrait clips found for '{query}', falling back to landscape...")
            url = f"https://api.pexels.com/videos/search?query={urllib.parse.quote(query)}&per_page=3"
            r = requests.get(url, headers=headers)
            data = r.json()

        if data.get('videos'):
            options = []
            for video in data['videos']:
                files = video.get('video_files', [])
                # try to find HD first
                hd_files = [f for f in files if f.get('quality') == 'hd']
                if hd_files:
                    options.append(hd_files[0]['link'])
                elif files:
                    options.append(files[0]['link'])
            if options: return options
    except Exception as e:
        print(f"  -> Pexels Video API error: {e}")
    return None

async def fetch_coverr_video(query):
    if not COVERR_API_KEY: return None
    print(f"  -> Searching Coverr Videos for: '{query}'")
    try:
        url = f"https://api.coverr.co/videos?query={urllib.parse.quote(query)}"
        headers = {"Authorization": f"Bearer {COVERR_API_KEY}"}
        r = requests.get(url, headers=headers)
        if r.status_code == 200:
            data = r.json()
            if data.get('hits'):
                options = []
                for hit in data['hits'][:3]:
                    # Usually hit['urls']['mp4'] or similar
                    urls = hit.get('urls', {})
                    link = urls.get('mp4') or urls.get('sd') or urls.get('hd')
                    if link: options.append(link)
                if options: return options
    except Exception as e:
        print(f"  -> Coverr Video API error: {e}")
    return None

async def fetch_pixabay_video(query):
    if not PIXABAY_API_KEY: return None
    print(f"  -> Searching Pixabay Videos for: '{query}'")
    try:
        # First try to find natively vertical videos for Reels
        url = f"https://pixabay.com/api/videos/?key={PIXABAY_API_KEY}&q={urllib.parse.quote(query)}&per_page=3&safesearch=true&orientation=vertical"
        r = requests.get(url)
        data = r.json()
        
        # Fallback to any orientation if no vertical clips exist
        if data.get('totalHits', 0) == 0:
            print(f"  -> No vertical clips found for '{query}', falling back to landscape...")
            url = f"https://pixabay.com/api/videos/?key={PIXABAY_API_KEY}&q={urllib.parse.quote(query)}&per_page=3&safesearch=true"
            r = requests.get(url)
            data = r.json()

        if data.get('totalHits', 0) > 0:
            options = []
            for hit in data['hits'][:3]:
                videos = hit['videos']
                url = videos.get('large', {}).get('url') or videos.get('medium', {}).get('url') or videos.get('tiny', {}).get('url')
                if url: options.append(url)
            
            if options: return options
    except Exception as e:
        print(f"  -> Pixabay Video API error: {e}")
    return None

async def fetch_wikimedia_image(query):
    print(f"  -> Fetching image from Wikimedia Commons for: '{query}'")
    try:
        search_url = "https://commons.wikimedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "prop": "imageinfo",
            "iiprop": "url",
            "generator": "search",
            "gsrsearch": f"{query} -filetype:pdf -filetype:djvu -filetype:svg", # Exclude problem formats
            "gsrnamespace": 6,
            "gsrlimit": 1
        }
        
        headers = {
            "User-Agent": "YTAutoStudio/1.0 (admin@ytauto.local) Python/3"
        }
        response = requests.get(search_url, params=params, headers=headers)
        data = response.json()
        
        pages = data.get("query", {}).get("pages", {})
        if not pages:
            return None
            
        page_id = list(pages.keys())[0]
        image_info = pages[page_id].get("imageinfo", [])
        
        if image_info and "url" in image_info[0]:
            return image_info[0]["url"]
            
    except Exception as e:
        print(f"  -> Wikimedia API error: {e}")
    return None

async def process_reel_scene_asset(scene):
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    scene_id = scene['id']
    query = scene.get('search_query', '')
    
    if not query:
        supabase.table("reel_scenes").update({"status": "video_ready"}).eq("id", scene_id).execute()
        return

    print(f"\n[+] Processing Asset for Reel Scene {scene['scene_number']} (ID: {scene_id})")
    
    # Try all three video APIs and combine them
    asset_options = []
    
    pexels_vids = await fetch_pexels_video(query)
    if pexels_vids:
        asset_options.extend(pexels_vids[:2])
        
    pixabay_vids = await fetch_pixabay_video(query)
    if pixabay_vids:
        asset_options.extend(pixabay_vids[:2])
        
    coverr_vids = await fetch_coverr_video(query)
    if coverr_vids:
        asset_options.extend(coverr_vids[:2])
        
    is_video = True
    
    asset_url = asset_options[0] if asset_options else None
    
    if not asset_url:
        is_video = False
        asset_url = await fetch_wikimedia_image(query)
        if asset_url: asset_options = [asset_url]
    
    # Save media_options to the database
    if asset_options:
        try:
            supabase.table("reel_scenes").update({"media_options": asset_options}).eq("id", scene_id).execute()
        except Exception as e:
            print(f"  -> DB Error saving media_options: {e}")

    if asset_url:
        print(f"  -> Found asset ({'Video' if is_video else 'Image'}): {asset_url}")
        
        # Download the asset locally
        try:
            headers = {"User-Agent": "YTAutoStudio/1.0 (admin@ytauto.local) Python/3"}
            r = requests.get(asset_url, headers=headers)
            if r.status_code == 200:
                os.makedirs("frontend/public/assets/images", exist_ok=True)
                ext = asset_url.split('.')[-1].split('?')[0]
                if ext not in ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'webm']: 
                    ext = 'mp4' if is_video else 'jpg'
                
                local_path = f"frontend/public/assets/images/reel_scene_{scene_id}.{ext}"
                with open(local_path, "wb") as f:
                    f.write(r.content)
                
                public_url = f"/assets/images/reel_scene_{scene_id}.{ext}"
                supabase.table("reel_scenes").update({"status": "video_ready", "image_url": public_url}).eq("id", scene_id).execute()
                print(f"[+] Asset downloaded and saved for Reel Scene {scene['scene_number']}")
                return
        except Exception as e:
            print(f"  -> Error downloading asset: {e}")
            
    print(f"[-] Failed to fetch or download asset for Scene {scene['scene_number']}. Using fallback.")
    fallback_url = "https://images.unsplash.com/photo-1461360370896-922624d12aa1?auto=format&fit=crop&q=80&w=1000"
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    supabase.table("reel_scenes").update({"status": "video_ready", "image_url": fallback_url}).eq("id", scene_id).execute()
