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
    if not master_audio_rel: 
        print("[-] Master audio URL missing for reel!")
        return
        
    os.makedirs("local_cache/assets/audio", exist_ok=True)
    master_audio_path = f"local_cache/assets/audio/reel_{reel_id}_master.mp3"
    
    # Download master audio if not present locally
    if not os.path.exists(master_audio_path) or os.path.getsize(master_audio_path) == 0:
        if master_audio_rel.startswith("http"):
            print(f"  -> Downloading master audio from Supabase: {master_audio_rel}")
            import requests
            r = requests.get(master_audio_rel)
            if r.status_code == 200:
                with open(master_audio_path, "wb") as f:
                    f.write(r.content)
            else:
                print(f"[-] Failed to download master audio: status {r.status_code}")
                return

    try:
        audio = AudioSegment.from_mp3(master_audio_path)
        duration_sec = len(audio) / 1000.0
    except Exception as e:
        print(f"[-] Could not load audio: {e}")
        duration_sec = 60.0

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

    # Determine resolution from orientation or aspect ratio
    orientation = reel.get("orientation", "16:9")
    if orientation == "9:16":
        width, height = 1080, 1920
    else:
        width, height = 1920, 1080

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(f"[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\n\n")
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

    compile_mode = reel.get("compile_mode")
    if compile_mode == "scene_based":
        chunkSize = 1
    elif compile_mode == "portion_based":
        chunkSize = 4
    else:
        # Fallback Auto-Detect Mode
        has_individual_scene_assets = any(
            sc.get("video_url") or sc.get("image_url") 
            for idx, sc in enumerate(scenes) if idx % 4 != 0
        )
        chunkSize = 1 if has_individual_scene_assets else (4 if reel.get("reel_type") == "sleep" else 1)
    
    print(f"  -> Movie Compiler Mode: {'Scene-Based (1 Scene / Unit)' if chunkSize == 1 else 'Portion-Based (4 Scenes / Unit)'}")
    portions = []
    for i in range(0, len(scenes), chunkSize):
        portions.append(scenes[i:i + chunkSize])

    visible_chunks = []
    for portion in portions:
        leader = portion[0]
        portion_duration = 0.0
        for sc in portion:
            p_time = scene_durations.get(sc["id"])
            if not p_time:
                # Measure exact mp3 audio file duration for this scene
                audio_url = sc.get("audio_url")
                if audio_url:
                    try:
                        import requests
                        r = requests.get(audio_url)
                        if r.status_code == 200:
                            tmp_mp3 = f"temp_sc_{sc['id']}.mp3"
                            with open(tmp_mp3, "wb") as f: f.write(r.content)
                            p_time = len(AudioSegment.from_mp3(tmp_mp3)) / 1000.0
                            if os.path.exists(tmp_mp3): os.remove(tmp_mp3)
                    except Exception as ex:
                        print(f"[-] Could not fetch audio length for scene {sc['id']}: {ex}")
            
            if not p_time: p_time = 3.0
            if sc.get("trim_end"): p_time = float(sc["trim_end"])
            portion_duration += p_time

        asset_url = leader.get("video_url") or leader.get("image_url")
        if not asset_url:
            # Fallback to any follower scene asset in this portion
            for f in portion[1:]:
                if f.get("video_url") or f.get("image_url"):
                    asset_url = f.get("video_url") or f.get("image_url")
                    break

        visible_chunks.append({
            "leader": leader,
            "asset_url": asset_url,
            "duration": max(2.0, portion_duration)
        })
            
    chunk_files = []
    
    # 2. Generate retimed chunk video files using FFmpeg
    for i, chunk in enumerate(visible_chunks):
        asset_url = chunk.get("asset_url")
        time_per_scene = chunk["duration"]
        
        chunk_path = f"temp_chunk_{reel_id}_{i}.mp4"
        chunk_files.append(chunk_path)
        
        if not asset_url:
            print(f"  -> Portion {i+1} has no visual asset, creating black fallback card ({time_per_scene:.2f}s)...")
            cmd = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}", "-t", str(time_per_scene),
                "-vf", f"drawtext=text='Portion {i+1}':fontcolor=white:fontsize=48:x=(w-tw)/2:y=(h-th)/2",
                "-c:v", "libx264", "-r", "30", "-an", chunk_path
            ]
            await run_ffmpeg(cmd)
            continue

        if asset_url.startswith("http://") or asset_url.startswith("https://"):
            asset_path = asset_url
        else:
            asset_path = os.path.abspath(os.path.join("frontend", "public", asset_url.lstrip("/")))
            asset_path = asset_path.replace("\\", "/")
            if not os.path.exists(asset_path):
                # Check if it was saved directly in root or local_cache
                alt_path = asset_url.lstrip("/")
                if os.path.exists(alt_path):
                    asset_path = alt_path
                else:
                    print(f"  -> Asset file not found locally ({asset_url}), generating fallback card ({time_per_scene:.2f}s)...")
                    cmd = [
                        "ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s={width}x{height}", "-t", str(time_per_scene),
                        "-vf", f"drawtext=text='Scene {i+1}':fontcolor=white:fontsize=48:x=(w-tw)/2:y=(h-th)/2",
                        "-c:v", "libx264", "-r", "30", "-an", chunk_path
                    ]
                    await run_ffmpeg(cmd)
                    continue
        
        ext = asset_path.split('?')[0].split('.')[-1].lower()
        is_video = ext in ['mp4', 'webm', 'mov']
        
        print(f"  -> Stitching Unit {i+1} ({'Wan2.x Video' if is_video else 'FLUX Image'}), Duration: {time_per_scene:.2f}s...")
        
        fade_out_st = max(0, time_per_scene - 0.5)
        
        # Dual Video Generation handling for scenes/portions > 30 seconds
        secondary_asset_url = chunk.get("leader", {}).get("secondary_video_url") or chunk.get("leader", {}).get("video_url_2")
        
        try:
            if secondary_asset_url and time_per_scene > 30.0:
                print(f"  -> Audio > 30s ({time_per_scene:.1f}s): Stitching 2 distinct video generations for Unit {i+1}...")
                half_t = time_per_scene / 2.0
                c1_path = f"sub_c1_{reel_id}_{i}.mp4"
                c2_path = f"sub_c2_{reel_id}_{i}.mp4"
                
                vf_h = f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p"
                
                # Render Sub-video 1
                cmd1 = ["ffmpeg", "-y", "-i", asset_path, "-t", str(half_t), "-filter_complex", f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},split[v1][v2];[v2]reverse[vrev];[v1][vrev]concat=n=2:v=1[bm];[bm]loop=loop=-1:size=600:start=0,format=yuv420p", "-c:v", "libx264", "-an", c1_path]
                await run_ffmpeg(cmd1)
                
                # Render Sub-video 2
                sec_path = secondary_asset_url if secondary_asset_url.startswith("http") else os.path.abspath(os.path.join("frontend", "public", secondary_asset_url.lstrip("/")))
                cmd2 = ["ffmpeg", "-y", "-i", sec_path, "-t", str(half_t), "-filter_complex", f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},split[v1][v2];[v2]reverse[vrev];[v1][vrev]concat=n=2:v=1[bm];[bm]loop=loop=-1:size=600:start=0,format=yuv420p", "-c:v", "libx264", "-an", c2_path]
                await run_ffmpeg(cmd2)
                
                # Concat sub-videos into chunk_path
                sub_concat = f"sub_concat_{reel_id}_{i}.txt"
                with open(sub_concat, "w") as scf:
                    scf.write(f"file '{c1_path}'\nfile '{c2_path}'\n")
                
                cmd_cc = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", sub_concat, "-vf", f"fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out_st:.2f}:d=0.5,format=yuv420p", "-c:v", "libx264", "-an", chunk_path]
                await run_ffmpeg(cmd_cc)
                
                if os.path.exists(c1_path): os.remove(c1_path)
                if os.path.exists(c2_path): os.remove(c2_path)
                if os.path.exists(sub_concat): os.remove(sub_concat)
                
            elif is_video:
                # Advanced Ping-Pong Boomerang Looping Filter (Forward -> Reverse -> Forward)
                vf_pingpong = (
                    f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                    f"split[v1][v2];[v2]reverse[vrev];[v1][vrev]concat=n=2:v=1[boomerang];"
                    f"[boomerang]loop=loop=-1:size=600:start=0,"
                    f"fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out_st:.2f}:d=0.5,format=yuv420p"
                )
                cmd = [
                    "ffmpeg", "-y", "-i", asset_path, "-t", str(time_per_scene),
                    "-filter_complex", vf_pingpong, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
                ]
                await run_ffmpeg(cmd)
            else:
                # Gentle Slow-Motion Ken Burns Pan/Zoom Filter for long static images over 100s+
                vf_kenburns = (
                    f"loop=1:size=1:start=0,"
                    f"scale={width*2}:{height*2},"
                    f"zoompan=z='min(zoom+0.0003,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height},"
                    f"fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out_st:.2f}:d=0.5,format=yuv420p"
                )
                cmd = [
                    "ffmpeg", "-y", "-i", asset_path, "-t", str(time_per_scene),
                    "-vf", vf_kenburns, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
                ]
                await run_ffmpeg(cmd)
        except Exception as e:
            print(f"[-] Filter error on Unit {i+1}, falling back to standard loop: {e}")
            vf_simple = f"fps=30,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fade=t=in:st=0:d=0.5,fade=t=out:st={fade_out_st:.2f}:d=0.5,format=yuv420p"
            if is_video:
                cmd = [
                    "ffmpeg", "-y", "-fflags", "+genpts", "-stream_loop", "-1", "-i", asset_path, "-t", str(time_per_scene),
                    "-vf", vf_simple, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
                ]
            else:
                cmd = [
                    "ffmpeg", "-y", "-loop", "1", "-i", asset_path, "-t", str(time_per_scene),
                    "-vf", vf_simple, "-c:v", "libx264", "-r", "30", "-video_track_timescale", "90000", "-an", chunk_path
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
