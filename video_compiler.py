import os
import time
import subprocess
from dotenv import load_dotenv
from supabase import create_client, Client
from pydub import AudioSegment
import asyncio

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def upload_to_media_bucket(local_path, destination_path, content_type):
    try:
        with open(local_path, "rb") as f:
            supabase.storage.from_("media").upload(
                path=destination_path,
                file=f,
                file_options={"content-type": content_type, "x-upsert": "true"}
            )
        return supabase.storage.from_("media").get_public_url(destination_path)
    except Exception as e:
        print(f"[-] Supabase Storage Upload Error: {e}")
        return f"/assets/{destination_path}"

os.environ["PATH"] += os.pathsep + os.path.abspath(os.getcwd())

async def run_ffmpeg(cmd):
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise Exception(f"FFmpeg error: {stderr.decode('utf-8', errors='ignore')}")

async def compile_final_video(reel_id):
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    print(f"\n[+] Compiling Mixed Media Final Video for Reel {reel_id}")
    
    res = supabase.table("reels").select("*").eq("id", reel_id).single().execute()
    if not res.data: return
    reel = res.data
    
    scenes_res = supabase.table("reel_scenes").select("*").eq("reel_id", reel_id).order("scene_number").execute()
    scenes = scenes_res.data
    
    if not scenes: return
        
    master_audio_rel = reel.get("master_audio_url")
    if not master_audio_rel: return
        
    master_audio_path = f"local_cache/assets/audio/reel_{reel_id}_master.mp3"
    
    try:
        audio = AudioSegment.from_mp3(master_audio_path)
        duration_sec = len(audio) / 1000.0
    except Exception as e:
        print(f"[-] Could not load audio: {e}")
    # 1. Load exact audio durations and build ASS Subtitles
    timing_path = f"local_cache/assets/audio/reel_{reel_id}_timing.json"
    timing_map = []
    if os.path.exists(timing_path):
        import json
        with open(timing_path, "r") as f:
            timing_map = json.load(f)
            
    ass_path = f"master_subtitles_{reel_id}.ass"
    def format_ass_time(ms):
        h = int(ms // 3600000)
        m = int((ms % 3600000) // 60000)
        s = int((ms % 60000) // 1000)
        cs = int((ms % 1000) // 10)
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n")
        f.write("[V4+ Styles]\n")
        f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
        f.write("Style: Hook,Arial Black,80,&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,6,4,2,10,10,960,1\n")
        f.write("Style: Standard,Segoe UI Black,55,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,3,2,20,20,200,1\n\n")
        f.write("[Events]\n")
        f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
        for node in timing_map:
            if not node.get('dialogue'): continue
            start_time = format_ass_time(node['start_ms'])
            end_time = format_ass_time(node['end_ms'])
            style = "Hook" if node.get('scene_number') == 1 else "Standard"
            text = node['dialogue'].replace('\n', '\\N')
            f.write(f"Dialogue: 0,{start_time},{end_time},{style},,0,0,0,,{text}\n")
            
    scene_durations = {}
    for i, node in enumerate(timing_map):
        sid = node['scene_id']
        if i + 1 < len(timing_map):
            dur_sec = (timing_map[i+1]['start_ms'] - node['start_ms']) / 1000.0
        else:
            dur_sec = max((node['end_ms'] - node['start_ms']) / 1000.0, (duration_sec * 1000.0 - node['start_ms']) / 1000.0)
        scene_durations[sid] = dur_sec

    visible_chunks = []
    current_chunk = None
    
    for scene in scenes:
        scene_id = scene["id"]
        scene_time = scene_durations.get(scene_id, 2.0)
        
        if scene.get("trim_end"):
            scene_time = float(scene["trim_end"])
            
        if scene.get("is_hidden") and current_chunk is not None:
            current_chunk['duration'] += scene_time
        else:
            current_chunk = {
                "scene": scene,
                "duration": scene_time
            }
            visible_chunks.append(current_chunk)
            
    chunk_files = []
    
    # 2. Generate individual chunks
    for i, chunk in enumerate(visible_chunks):
        scene = chunk["scene"]
        time_per_scene = chunk["duration"]
        
        img_rel = scene.get("image_url")
        if not img_rel: continue
        
        if img_rel.startswith("http://") or img_rel.startswith("https://"):
            asset_path = img_rel
        else:
            asset_path = os.path.abspath(os.path.join("frontend", "public", img_rel.lstrip("/")))
            asset_path = asset_path.replace("\\", "/")
        
        ext = asset_path.split('.')[-1].lower()
        is_video = ext in ['mp4', 'webm', 'mov']
        
        chunk_path = f"temp_chunk_{reel_id}_{i}.mp4"
        chunk_files.append(chunk_path)
        
        print(f"  -> Processing Chunk {i} ({'Video' if is_video else 'Image'}), Duration: {time_per_scene:.2f}s...")
        
        # Calculate fade out start time
        fade_out_st = max(0, time_per_scene - 0.5)
        
        # Build complex filter: scale, crop, fade in (0.5s), fade out (0.5s)
        vf = f"fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out_st:.2f}:d=0.5,format=yuv420p"
        
        trim_start = scene.get("trim_start", 0) or 0
        
        try:
            if is_video:
                # Add -fflags +genpts and seek properly for stable looping
                cmd = [
                    "ffmpeg", "-y", "-fflags", "+genpts", "-stream_loop", "-1", "-i", asset_path, "-ss", str(trim_start), "-t", str(time_per_scene),
                    "-vf", vf, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
                ]
            else:
                cmd = [
                    "ffmpeg", "-y", "-loop", "1", "-i", asset_path, "-t", str(time_per_scene),
                    "-vf", vf, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
                ]
            await run_ffmpeg(cmd)
        except Exception as e:
            print(f"[-] Error processing chunk {i}: {e}")
            # Fallback chunk with error text so the user knows it failed
            cmd = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920", "-t", str(time_per_scene),
                "-vf", "drawtext=text='FFmpeg Render Error':fontcolor=white:fontsize=48:x=(w-tw)/2:y=(h-th)/2",
                "-c:v", "libx264", "-an", chunk_path
            ]
            await run_ffmpeg(cmd)

    # 2. Create FFmpeg concat file for chunks
    concat_file_path = f"temp_concat_{reel_id}.txt"
    with open(concat_file_path, "w", encoding="utf-8") as f:
        for chunk in chunk_files:
            f.write(f"file '{chunk}'\n")
            
    # 3. Run Final FFmpeg mix
    os.makedirs("local_cache/assets/videos", exist_ok=True)
    out_path = f"local_cache/assets/videos/reel_{reel_id}_final.mp4"
    public_url = f"/assets/videos/reel_{reel_id}_final.mp4"
    
    if os.path.exists(out_path): os.remove(out_path)
        
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file_path,
        "-i", master_audio_path,
        "-vf", f"ass={ass_path}",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        out_path
    ]
    
    print("  -> Concat and Mixing Audio...")
    try:
        await run_ffmpeg(cmd)
        
        # Upload the final video to Supabase
        print("  -> Uploading final video to Supabase Storage...")
        public_url = upload_to_media_bucket(out_path, f"videos/reel_{reel_id}_final.mp4", "video/mp4")
        
    except Exception as e:
        print(f"[-] Final FFmpeg error: {e}")
        supabase.table("reels").update({"status": "error"}).eq("id", reel_id).execute()
        return
    finally:
        # Cleanup temp files
        if os.path.exists(concat_file_path): os.remove(concat_file_path)
        if os.path.exists(ass_path): os.remove(ass_path)
        for chunk in chunk_files:
            if os.path.exists(chunk): os.remove(chunk)

    print(f"[+] Final Mixed-Media Video compiled successfully: {public_url}")
    
    # 4. Update Database
    supabase.table("reels").update({
        "status": "completed",
        "final_video_url": public_url
    }).eq("id", reel_id).execute()

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        asyncio.run(compile_final_video(sys.argv[1]))
