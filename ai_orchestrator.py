import os
import asyncio
import json
import re
import urllib.parse
import traceback
import base64
import uuid
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import AsyncOpenAI
import google.generativeai as genai
from anthropic import AsyncAnthropic
from openai import OpenAI
import concurrent.futures

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    supabase.storage.create_bucket("images")
except:
    pass

together_client = OpenAI(
  api_key=os.getenv("TOGETHER_API_KEY"),
  base_url="https://api.together.xyz/v1",
)

class KeyRotator:
    def __init__(self, env_var_name):
        keys_str = os.getenv(env_var_name, "")
        self.keys = [k.strip() for k in keys_str.split(",") if k.strip()]
        self.index = 0

    def get_key(self):
        if not self.keys:
            return None
        key = self.keys[self.index]
        self.index = (self.index + 1) % len(self.keys)
        return key

gemini_keys = KeyRotator("GEMINI_API_KEY")
groq_keys = KeyRotator("GROQ_API_KEY")
openrouter_keys = KeyRotator("OPENROUTER_API_KEY")

# Mapping role to OpenAI role format and merging consecutive messages
def format_messages_for_openai(chat_history):
    merged = []
    for msg in chat_history:
        if not msg["content"]: continue
        
        role = "assistant" if msg["role"] == "ai" else msg["role"]
        
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] += "\n\n" + msg["content"]
        else:
            merged.append({"role": role, "content": msg["content"]})
    return merged

import time
import base64
import uuid

def get_angle_url(angle_prompt):
    full_prompt = f"{angle_prompt}. 8k resolution, highly detailed, character design sheet style."
    try:
        response = together_client.images.generate(
            prompt=full_prompt,
            model="black-forest-labs/FLUX.1-schnell",
            n=1,
            response_format="b64_json"
        )
        b64 = response.data[0].b64_json
        image_data = base64.b64decode(b64)
        filename = f"{uuid.uuid4()}.png"
        supabase.storage.from_("images").upload(
            path=filename,
            file=image_data,
            file_options={"content-type": "image/png"}
        )
        url = supabase.storage.from_("images").get_public_url(filename)
        return url
    except Exception as e:
        print(f"     [!] Failed to generate/upload image: {e}")
        if "429" in str(e):
            print("     [!] Rate limit hit, backing off...")
            time.sleep(5)
        return ""

async def generate_with_gemini_native(messages, system_prompt):
    if not gemini_keys.keys: raise Exception("No Gemini keys")
    last_error = None
    
    # Format messages for google.generativeai
    formatted_messages = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        formatted_messages.append({"role": role, "parts": [msg["content"]]})
        
    for _ in range(len(gemini_keys.keys)):
        key = gemini_keys.get_key()
        try:
            print(f"[~] Trying Gemini key ending in {key[-4:] if key else 'None'}...")
            genai.configure(api_key=key)
            
            # Google GenAI doesn't accept empty system instructions
            sys_inst = system_prompt if system_prompt and len(system_prompt.strip()) > 0 else None
            model = genai.GenerativeModel(model_name='gemini-2.5-flash', system_instruction=sys_inst)
            
            # Run blocking call in thread pool since genai chat is sync
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(None, lambda: model.generate_content(formatted_messages))
            print(f"[+] Successfully generated using Gemini API!")
            return response.text
        except Exception as e:
            print(f"[-] Gemini Key failed: {e}")
            last_error = e
    raise last_error

async def generate_with_groq_native(messages, system_prompt):
    if not groq_keys.keys: raise Exception("No Groq keys")
    last_error = None
    model_name = "llama-3.3-70b-versatile"
    
    for _ in range(len(groq_keys.keys)):
        key = groq_keys.get_key()
        try:
            print(f"[~] Trying Groq key ending in {key[-4:] if key else 'None'}...")
            client = AsyncOpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
            msgs = [{"role": "system", "content": system_prompt}] + messages
            response = await client.chat.completions.create(model=model_name, messages=msgs)
            print(f"[+] Successfully generated using Groq API!")
            return response.choices[0].message.content
        except Exception as e:
            print(f"[-] Groq Key failed: {e}")
            last_error = e
    raise last_error

async def generate_with_ai(messages, system_prompt, requested_model="gemini"):
    # If the user explicitly requested groq, just use groq
    if requested_model.lower() == "groq":
        return await generate_with_groq_native(messages, system_prompt)
        
    # Otherwise, try Gemini first
    try:
        return await generate_with_gemini_native(messages, system_prompt)
    except Exception as e:
        print(f"[-] All Gemini keys failed ({e}). Falling back to Groq...")
        # Fallback to Groq if Gemini is unavailable
        return await generate_with_groq_native(messages, system_prompt)

async def process_chat_message(pending_msg):
    msg_id = pending_msg['id']
    episode_id = pending_msg['episode_id']
    model_name = pending_msg['model']
    
    print(f"\n[+] Processing pending chat for model: {model_name} (Episode: {episode_id})")
    
    try:
        res = supabase.table("episode_chats") \
            .select("*") \
            .eq("episode_id", episode_id) \
            .order("created_at", desc=False) \
            .execute()
        
        all_msgs = res.data
        
        history = []
        for m in all_msgs:
            if m['id'] == msg_id:
                break
            if m['role'] == 'user' or (m['role'] == 'ai' and m['model'] == model_name and m['status'] == 'success'):
                history.append(m)
        
        messages = format_messages_for_openai(history)
        
        ep_res = supabase.table("episodes").select("*, series(*)").eq("id", episode_id).single().execute()
        ep_data = ep_res.data
        series_data = ep_data.get('series', {}) or {}
        
        ep_title = ep_data.get('title', 'Unknown Episode')
        ep_summary = ep_data.get('overall_summary', 'No summary provided.')
        series_plot = series_data.get('plot_summary') or 'No overarching series summary provided.'
        
        SYSTEM_PROMPT = f"""You are a professional, elite YouTube scriptwriter and AI Director.
Your ONLY job is to output the requested script or modifications.

--- CONTEXT FOR THIS GENERATION ---
SERIES PLOT / LORE:
{series_plot}

CURRENT EPISODE: {ep_title}
EPISODE SUMMARY: {ep_summary}
-----------------------------------

CRITICAL RULES:
1. NO YAPPING. Do NOT include any conversational preamble, postamble, or filler (e.g. "Here is your script", "Let me know what you think"). 
2. START IMMEDIATELY with the script content.
3. Every script must clearly define the Characters, their personalities, and the Core Story Context at the very top to ensure consistency.
4. Format the script PERFECTLY for an AI Video Generation pipeline (Wan 2.6 & Audio TTS).
5. For audio narration, use Kokoro native voice styles: [af_bella] for soothing female, [am_adam] for dramatic male, [af_nicole] for whispering/calm female, [am_michael] for energetic male. Append <voice="kokoro_STYLE_NAME"> to the character dialogue.

Use this EXACT format for every scene:

[Scene 1]
Visual: (Highly descriptive prompt for the Wan 2.6 Video Generator. Focus on camera angles, lighting, subject action, and environment. NO dialogue here.)
[Character Name]: "The exact spoken dialogue for the TTS engine."
[Another Character]: "More dialogue."
"""
        
        print(f"--- Payload for {model_name} ---")
        print(messages)
        print("--------------------------------")
        
        if not messages:
            raise Exception("No context messages found.")

        content = None
        try:
            content = await generate_with_ai(messages, SYSTEM_PROMPT, requested_model=model_name)
        except Exception as e:
            print(f"[-] Error generating for {model_name}: {e}")
                
        if not content:
            raise Exception(f"Generation failed.")

        supabase.table("episode_chats").update({
            "content": content,
            "status": "success"
        }).eq("id", msg_id).execute()
        print(f"[+] Successfully generated response")

    except Exception as e:
        print(f"[-] Error generating for {model_name}: {e}")
        supabase.table("episode_chats").update({
            "content": f"Error: {e}",
            "status": "error"
        }).eq("id", msg_id).execute()


async def process_reel_chat_message(pending_msg):
    msg_id = pending_msg['id']
    reel_id = pending_msg['reel_id']
    model_name = pending_msg['model']
    
    print(f"\n[+] Processing pending chat for model: {model_name} (Reel: {reel_id})")
    
    try:
        res = supabase.table("reel_chats") \
            .select("*") \
            .eq("reel_id", reel_id) \
            .order("created_at", desc=False) \
            .execute()
        
        all_msgs = res.data
        
        history = []
        for m in all_msgs:
            if m['id'] == msg_id:
                break
            if m['role'] == 'user' or (m['role'] == 'ai' and m['model'] == model_name and m['status'] == 'success'):
                history.append(m)
        
        messages = format_messages_for_openai(history)
        
        # Fetch reel info to get type
        reel_res = supabase.table("reels").select("reel_type").eq("id", reel_id).single().execute()
        reel_type = reel_res.data.get("reel_type", "standard") if reel_res.data else "standard"
        
        if reel_type == "sleep":
            SYSTEM_PROMPT = """You are a professional AI scriptwriter specializing in Sleep Stories and ASMR.
Your ONLY job is to output the requested script or modifications.

CRITICAL RULES:
1. NO YAPPING. Do NOT include any conversational preamble, postamble, or filler.
2. START IMMEDIATELY with the script content.
3. The pacing MUST be extremely slow, rhythmic, and calming. Focus on soothing sensory details (soft sounds, gentle breezes, warmth, peaceful darkness).
4. Scene 1 MUST establish a deeply relaxing environment immediately.
5. The script MUST be extremely long, around 4000 to 5000 words, representing a 30 to 40 minute long narration. 
6. Format the script PERFECTLY for our Automated TTS. Use Kokoro voice style <voice="kokoro_af_bella"> for the most soothing tone.

Use this EXACT format for every scene:

[Scene 1]
[Character Name]: "The exact spoken dialogue for the TTS engine. Make it sound whispered and gentle. (Continue for a very long time...)"

[Scene 2]
[Character Name]: "Continue the story with extremely slow, repetitive, and soothing descriptions..."
"""
        else:
            SYSTEM_PROMPT = """You are a professional, elite YouTube Shorts & TikTok scriptwriter.
Your ONLY job is to output the requested script or modifications.

CRITICAL RULES:
1. NO YAPPING. Do NOT include any conversational preamble, postamble, or filler.
2. START IMMEDIATELY with the script content.
3. Every script MUST be paced for a 60-90 second Short (approx 150-180 words). High retention, fast-paced storytelling!
4. Scene 1 MUST be a highly dramatic, controversial, or extremely punchy 2-3 second HOOK (approx 5-10 words). This hook is designed to stop scrollers instantly.
5. Format the script PERFECTLY for our Automated Asset fetcher and TTS. Use <voice="Puck"> for energetic delivery.

Use this EXACT format for every scene:

[Scene 1]
Search: (Highly descriptive keywords for fetching a real historical photo from Wikimedia Commons. e.g. "Julius Caesar statue" or "World War 2 tanks")
[Character Name]: "The exact spoken dialogue for the TTS engine."
[Another Character]: "More dialogue."
"""
        
        print(f"--- Payload for Gemini (Reel) ---")
        print(messages)
        print("--------------------------------")
        
        if not messages:
            raise Exception("No context messages found.")

        content = None
        try:
            print(f"--- Attempting generation with {model_name} (Reel) ---")
            content = await generate_with_ai(messages, SYSTEM_PROMPT, requested_model=model_name)
            successful_model = model_name
        except Exception as e:
            print(f"[-] Gemini failed completely: {e}")
            
        if not content:
            raise Exception("All keys for Gemini failed.")

        supabase.table("reel_chats").update({
            "content": content,
            "status": "success"
        }).eq("id", msg_id).execute()
        print(f"[+] Successfully generated response for {successful_model}")

    except Exception as e:
        print(f"[-] Error generating for {model_name}: {e}")
        supabase.table("reel_chats").update({
            "content": f"Error: {e}",
            "status": "error"
        }).eq("id", msg_id).execute()

async def process_wb_chat_message(pending_msg):
    msg_id = pending_msg['id']
    series_id = pending_msg['series_id']
    model_name = pending_msg.get('model', 'gemini')
    content = pending_msg.get('content', '')
    
    print(f"\n[+] Processing pending chat for World Builder (Series: {series_id})")
    
    try:
        # Check if this is a hidden REGENERATE_IMAGE command from the user
        if content.startswith("[REGENERATE_IMAGE]"):
            print("  -> Intercepted REGENERATE_IMAGE command!")
            parts = content.replace("[REGENERATE_IMAGE]", "").strip().split("|")
            if len(parts) >= 2:
                char_id = parts[0].replace("CharID:", "").strip()
                angle = parts[1].replace("Angle:", "").strip()
                
                print(f"  -> Regenerating {angle} image for Character {char_id}...")
                
                char_res = supabase.table("characters").select("*").eq("id", char_id).single().execute()
                char = char_res.data
                
                prompt = char.get("visual_description", "") + f". View: strictly facing {angle}."
                if angle == "left": prompt = char.get("visual_description", "") + ". View: strictly facing left side profile."
                if angle == "right": prompt = char.get("visual_description", "") + ". View: strictly facing right side profile."
                if angle == "back": prompt = char.get("visual_description", "") + ". View: strictly facing away, showing the back."
                
                # Fetch series style
                series_res = supabase.table("series").select("*").eq("id", series_id).single().execute()
                style = series_res.data.get("global_positive_prompt", "")
                
                full_prompt = f"Character design. {prompt}. Style: {style}"
                
                try:
                    import asyncio
                    url = await asyncio.to_thread(get_angle_url, full_prompt)
                    
                    angle_key = f"view_{angle}_url"
                    supabase.table("characters").update({angle_key: url}).eq("id", char_id).execute()
                    print(f"  -> Successfully regenerated and saved {angle_key} for {char['name']}!")
                    
                    # Mark the hidden message as success so it doesn't poll again
                    supabase.table("world_builder_chats").update({"status": "success"}).eq("id", msg_id).execute()
                    return
                except Exception as e:
                    print(f"  -> Failed to regenerate image: {e}")
                    supabase.table("world_builder_chats").update({"status": "error", "content": f"Failed: {e}"}).eq("id", msg_id).execute()
                    return
                    
        # Otherwise, process normally
        series_res = supabase.table("series").select("*").eq("id", series_id).single().execute()
        series_data = series_res.data
        style = series_data.get("global_positive_prompt", "")
        
        # Fetch chat history
        res = supabase.table("world_builder_chats") \
            .select("*") \
            .eq("series_id", series_id) \
            .order("created_at", desc=False) \
            .execute()
        
        history = []
        for m in res.data:
            if m['id'] == msg_id:
                break
            if m['role'] == 'user' or (m['role'] == 'ai' and m['status'] == 'success'):
                history.append(m)
        
        messages = format_messages_for_openai(history)
        
        SYSTEM_PROMPT = """You are an elite AI Showrunner and Director. 
Your job is to brainstorm massive 10-15 episode story arcs, establish deep lore, and design characters with the user.

CRITICAL INSTRUCTION: You are in the Brainstorming Phase. Discuss ideas, pitch story arcs, and develop characters. 
DO NOT output the system tags below until the user explicitly says they are happy with the final lineup and asks to "finalize", "generate", or "push" the episodes/characters to the dashboard.

WHEN THE USER IS READY TO FINALIZE:
You MUST output a summary of EVERYTHING you agreed upon using these EXACT tags (each on a new line, no markdown blocks):

For every character agreed upon:
[NEW_CHARACTER] Name: {character name} | Voice: {voice style/ID} | Visual_Front: {detailed visual description, explicitly facing forward} | Visual_Left: {detailed visual description, explicitly facing left profile} | Visual_Right: {detailed visual description, explicitly facing right profile} | Visual_Back: {detailed visual description, explicitly facing away/back}

For every single episode in the series arc:
[NEW_EPISODE] Title: {episode title} | Context: {1-2 sentence plot summary}

Keep your conversational tone engaging and creative. Always pitch ideas and ask what the user thinks!"""

        content = await generate_with_ai(messages, SYSTEM_PROMPT, requested_model=model_name)

        if not content:
            content = "The AI model returned an empty response (possibly due to safety filters or a temporary API issue). Please try again."

        # 1. Update chat message
        supabase.table("world_builder_chats").update({
            "content": content,
            "status": "success"
        }).eq("id", msg_id).execute()
        print(f"[+] Successfully generated World Builder response")

        # 2. Check for Tags
        if "[NEW_CHARACTER]" in content or "[NEW_EPISODE]" in content:
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith("[NEW_CHARACTER]"):
                    parts = line.replace("[NEW_CHARACTER]", "").strip().split("|")
                    if len(parts) >= 6:
                        name = parts[0].replace("Name:", "").strip()
                        voice = parts[1].replace("Voice:", "").strip()
                        visual_front = parts[2].replace("Visual_Front:", "").strip()
                        visual_left = parts[3].replace("Visual_Left:", "").strip()
                        visual_right = parts[4].replace("Visual_Right:", "").strip()
                        visual_back = parts[5].replace("Visual_Back:", "").strip()
                        
                        # Generate Images via Together AI for all 4 angles concurrently
                        print(f"  -> Generating 4 image angles for {name} sequentially via Together AI...")
                        results = []
                        for prompt_part in [visual_front, visual_left, visual_right, visual_back]:
                            results.append(get_angle_url(prompt_part))
                            
                        front_url, left_url, right_url, back_url = results
                        
                        print(f"  -> Saving {name} to DB...")
                        supabase.table("characters").insert({
                            "series_id": series_id,
                            "name": name,
                            "elevenlabs_voice_id": voice,
                            "visual_description": visual_front,
                            "view_front_url": front_url,
                            "view_left_url": left_url,
                            "view_right_url": right_url,
                            "view_back_url": back_url
                        }).execute()
                        print(f"  -> Character {name} saved successfully with 4 angles!")
                        
                elif line.startswith("[REGENERATE_IMAGE]"):
                    parts = line.replace("[REGENERATE_IMAGE]", "").strip().split("|")
                    if len(parts) >= 2:
                        char_id = parts[0].replace("CharID:", "").strip()
                        angle = parts[1].replace("Angle:", "").strip()
                        
                        print(f"  -> Regenerating {angle} image for Character {char_id}...")
                        
                        # Fetch the character
                        char_res = supabase.table("characters").select("*").eq("id", char_id).execute()
                        if char_res.data:
                            char = char_res.data[0]
                            visual_desc = char.get('visual_description', '')
                            
                            angle_desc = ''
                            if angle == 'front': angle_desc = 'front view, full body'
                            elif angle == 'left': angle_desc = 'side profile view, facing left'
                            elif angle == 'right': angle_desc = 'side profile view, facing right'
                            elif angle == 'back': angle_desc = 'back view, from behind'
                            
                            full_prompt = f"{visual_desc}, {angle_desc}. 8k resolution, highly detailed, character design sheet style."
                            
                            try:
                                response = together_client.images.generate(
                                    prompt=full_prompt,
                                    model="black-forest-labs/FLUX.1-schnell",
                                    n=1,
                                    response_format="b64_json"
                                )
                                b64 = response.data[0].b64_json
                                image_data = base64.b64decode(b64)
                                filename = f"{uuid.uuid4()}.png"
                                supabase.storage.from_("images").upload(
                                    path=filename,
                                    file=image_data,
                                    file_options={"content-type": "image/png"}
                                )
                                url = supabase.storage.from_("images").get_public_url(filename)
                                
                                angleKey = f"view_{angle}_url"
                                supabase.table("characters").update({angleKey: url}).eq("id", char_id).execute()
                                print(f"  -> Successfully regenerated {angle} image!")
                            except Exception as e:
                                print(f"  -> Failed to regenerate image: {e}")
                                if "429" in str(e):
                                    print("     [!] Rate limit hit, backing off...")
                                    import time
                                    time.sleep(5)
                                
                        # Delete this command message so it doesn't stay in chat history
                        supabase.table("world_builder_chats").delete().eq("id", msg_id).execute()
                        return # Stop processing this message further
                        
                elif line.startswith("[NEW_EPISODE]"):
                    parts = line.replace("[NEW_EPISODE]", "").strip().split("|")
                    if len(parts) >= 2:
                        title = parts[0].replace("Title:", "").strip()
                        context = parts[1].replace("Context:", "").strip()
                        
                        print(f"  -> Discovered new episode: {title}. Saving to DB...")
                        
                        # Determine season_id
                        season_res = supabase.table("seasons").select("id").eq("series_id", series_id).order("season_number", desc=True).limit(1).execute()
                        if season_res.data:
                            season_id = season_res.data[0]['id']
                        else:
                            # Create Season 1
                            new_season = supabase.table("seasons").insert({
                                "series_id": series_id,
                                "season_number": 1,
                                "title": "Season 1"
                            }).execute()
                            season_id = new_season.data[0]['id']
                        
                        # Determine episode number
                        ep_res = supabase.table("episodes").select("episode_number").eq("season_id", season_id).execute()
                        next_num = len(ep_res.data) + 1 if ep_res.data else 1
                        
                        supabase.table("episodes").insert({
                            "series_id": series_id,
                            "season_id": season_id,
                            "episode_number": next_num,
                            "title": title,
                            "overall_summary": context,
                            "status": "draft"
                        }).execute()
                        print(f"  -> Episode {title} saved successfully!")

    except Exception as e:
        print(f"[-] Error generating for World Builder: {e}")
        supabase.table("world_builder_chats").update({
            "content": f"Error: {e}",
            "status": "error"
        }).eq("id", msg_id).execute()

import json

async def process_scene_breakdown(episode):
    ep_id = episode['id']
    series_id = episode['series_id']
    script = episode['final_script_content']
    print(f"\n[+] Breaking down script into scenes for Episode: {ep_id}")
    
    try:
        # 1. Fetch Series Global Art Style
        series_res = supabase.table("series").select("*").eq("id", series_id).single().execute()
        global_style = series_res.data.get("global_positive_prompt", "High quality cinematic lighting, highly detailed.")
        
        # 2. Fetch Characters for this Series
        chars_res = supabase.table("characters").select("*").eq("series_id", series_id).execute()
        char_bible = ""
        for c in chars_res.data:
            char_bible += f"- {c['name']}: {c.get('visual_description', 'No visual description')}\n"
            
        episode_context = episode.get('overall_summary', '')
            
        prompt = f"""
        You are an elite AI Cinematic Director. Take the following script and break it down into a JSON array of scenes.
        
        CRITICAL TIME CONSTRAINT (MAX 15 SECONDS PER SCENE):
        The video generation model (Wan 2.6) CANNOT generate clips longer than 15 seconds. 
        - You MUST break down the script into very short, punchy scenes.
        - If a character has a long monologue, split it across MULTIPLE consecutive scenes with different camera angles.
        - A character can realistically speak a MAXIMUM of 20 to 25 words in 15 seconds. Do not put more dialogue than that in a single scene.
        
        CRITICAL VISUAL RULES:
        Video models DO NOT KNOW who your characters are by name. You MUST explicitly describe their physical appearance, clothing, and face in EVERY single scene's visual prompt.
        
        SERIES GLOBAL ART STYLE (Include elements of this in your visuals):
        {global_style}
        
        EPISODE CONTEXT (Use this to determine the timeline/age of characters):
        {episode_context}
        
        CHARACTER BIBLE (Use these descriptions when a character is on screen):
        {char_bible}
        
        GOOD PROMPT EXAMPLE: "Close-up shot. A 30-year-old man with silver-streaked hair, wearing a dark denim jacket and glasses, is typing furiously on a laptop. Dramatic neon blue lighting illuminates his face from the screen. The camera slowly pushes in."
        BAD PROMPT EXAMPLE: "Leo is typing on a laptop." (BAD: Doesn't describe Leo, no camera movement, no lighting).
        
        For each scene, you must provide:
        1. A 'visual_prompt': Highly descriptive cinematic text detailing the camera angle, lighting, subject action, environment, and EXPLICIT character physical descriptions. Focus on visuals ONLY. Do NOT include dialogue in the visual prompt.
        2. A 'dialogue': The exact text to be spoken by the character. Leave empty if no dialogue (MUST BE UNDER 25 WORDS).
        3. A 'character_name': The name of the speaker. CRITICAL: You MUST use the EXACT name from the CHARACTER BIBLE above. Do not shorten it! Use the Episode Context to pick the right age version (e.g. use "Elara (Leo's Mom - Young Mother)" instead of just "Elara" if the episode takes place in the past).
        4. An 'emotion_tag': A short tag (e.g., 'angry', 'whispering', 'excited') for ElevenLabs voice generation.
        5. An 'ambient_audio_prompt': A brief description for Wan 2.6's native audio generation (e.g., "Heavy rain hitting concrete, distant sirens, low dramatic synth bass").

        Output ONLY a valid JSON array of objects. Example:
        [
          {{"visual_prompt": "Wide angle, dramatic lighting...","dialogue": "Hello!", "character_name": "Maya", "emotion_tag": "cheerful", "ambient_audio_prompt": "Birds chirping, gentle acoustic guitar"}}
        ]

        SCRIPT:
        {script}
        """
        
        content = await generate_with_ai([{"role": "user", "content": prompt}], "")
        
        # Clean up JSON if model wrapped in markdown
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
            
        scenes = json.loads(content)
        
        # Clear old scenes
        supabase.table("episode_scenes").delete().eq("episode_id", ep_id).execute()
        
        # Insert into episode_scenes
        scene_rows = []
        for i, s in enumerate(scenes):
            visual_prompt = s.get("visual_prompt", "")
            audio_prompt = s.get("ambient_audio_prompt", "")
            if audio_prompt:
                visual_prompt += f"\n[AUDIO: {audio_prompt}]"
                
            scene_rows.append({
                "episode_id": ep_id,
                "scene_number": i + 1,
                "visual_prompt": visual_prompt,
                "dialogue": s.get("dialogue", ""),
                "character_name": s.get("character_name", ""),
                "emotion_tag": s.get("emotion_tag", "")
            })
            
        supabase.table("episode_scenes").insert(scene_rows).execute()
        
        # Update episode status
        supabase.table("episodes").update({"status": "prompts_ready"}).eq("id", ep_id).execute()
        print(f"[+] Successfully generated scenes for Episode {ep_id}!")
    except Exception as e:
        print(f"[-] Failed to generate scenes: {e}")
        supabase.table("episodes").update({"status": "error_prompts"}).eq("id", ep_id).execute()

async def regenerate_scene_prompt(scene):
    scene_id = scene['id']
    print(f"\n[+] Regenerating Visual Prompt for Scene {scene['scene_number']} (ID: {scene_id})")
    
    prompt = f"""
    You are an AI director. Rewrite the visual prompt for this single scene to be more cinematic, descriptive, and perfect for the Wan 2.6 Video Generator.
    Focus on camera angles, lighting, subject action, and environment.
    
    Current dialogue: {scene.get('dialogue', '')}
    Current character: {scene.get('character_name', '')}
    
    Output ONLY the rewritten visual prompt text. No markdown, no preamble.
    """
    try:
        content = await generate_with_ai([{"role": "user", "content": prompt}], "")
        content = content.strip()
        
        # Keep status as audio_ready or whatever it was before by just setting it to a normal state. 
        # Actually, let's just set it to 'audio_ready' if audio_url exists, else 'draft'
        new_status = 'audio_ready' if scene.get('audio_url') else 'draft'
        
        supabase.table("episode_scenes").update({"status": new_status, "visual_prompt": content}).eq("id", scene_id).execute()
        print(f"[+] Successfully regenerated visual prompt for Scene {scene['scene_number']}")
    except Exception as e:
        print(f"[-] Failed to regenerate visual prompt: {e}")
        supabase.table("episode_scenes").update({"status": "error"}).eq("id", scene_id).execute()

async def process_reel_scene_breakdown(reel):
    reel_id = reel['id']
    script = reel['final_script_content']
    print(f"\n[+] Breaking down script into scenes for Reel: {reel_id}")
    
    if reel.get("reel_type") == "sleep":
        print("  -> Sleep story detected. Chunking natively without Gemini...")
        chunks = []
        current_chunk = ""
        for paragraph in script.split('\n'):
            if not paragraph.strip():
                continue
            if len(current_chunk) + len(paragraph) < 2000:
                current_chunk += paragraph + "\n"
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                current_chunk = paragraph + "\n"
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
            
        # Clear old scenes
        supabase.table("reel_scenes").delete().eq("reel_id", reel_id).execute()
        
        # Insert into reel_scenes
        scene_rows = []
        for i, chunk in enumerate(chunks):
            scene_rows.append({
                "reel_id": reel_id,
                "scene_number": i + 1,
                "search_query": "sleep audio chunk",
                "dialogue": chunk,
                "character_name": "Narrator",
                "emotion_tag": "calm",
                "voice": "kokoro_af_bella", # Use a soft Kokoro voice
                "speed": 0.85, # Slower for sleep stories
                "status": "pending"
            })
            
        supabase.table("reel_scenes").insert(scene_rows).execute()
        supabase.table("reels").update({"status": "prompts_ready"}).eq("id", reel_id).execute()
        print(f"[+] Successfully chunked sleep story for Reel {reel_id}!")
        return

    prompt = f"""
    You are an AI director for Historical Shorts. Take the following script and break it down into a JSON array of scenes.
    For each scene, you must provide:
    1. A 'search_query': A highly specific 1-3 word keyword phrase to search for a Stock Video on Pexels/Pixabay (e.g. "Rome Colosseum", "Space Launch", "Nature waterfall").
    2. A 'dialogue': The exact text to be spoken by the character. Leave empty if no dialogue. CRITICAL: DO NOT include the character name or any voice tags (like "Narrator:") in the dialogue field! ONLY include the actual spoken words.
    3. A 'character_name': The name of the speaker.
    4. A 'voice_id': Select the MOST APPROPRIATE Voice ID for this character from the following list. You can choose from Kokoro, OpenAI, Gemini Native Audio, or ElevenLabs.
       Kokoro Voices (Free, Unlimited, Highly Emotional):
       - 'kokoro_af_heart' (Emma - Warm, emotional, storytelling)
       - 'kokoro_af_bella' (Bella - Gentle, engaging, soft)
       - 'kokoro_am_adam' (Adam - Deep, confident, resonant)
       - 'kokoro_am_michael' (Michael - Powerful, dramatic, narrator)
       
       OpenAI Voices (Expressive, API-based):
       - 'openai_alloy' (Alloy - Androgynous, clear)
       - 'openai_echo' (Echo - Male, calm)
       - 'openai_fable' (Fable - British-sounding, expressive)
       - 'openai_onyx' (Onyx - Deep male voice)
       - 'openai_nova' (Nova - Female, energetic)
       - 'openai_shimmer' (Shimmer - Female, soft)

       Gemini Native Voices (Highly Expressive):
       - 'gemini_Puck' (Warm, soothing, excellent for storytelling and sleep)
       - 'gemini_Aoede' (Gentle, clear, highly engaging female voice)
       - 'gemini_Charon' (Deep, resonant, slightly mysterious)
       - 'gemini_Fenrir' (Powerful, strong, dramatic)
       - 'gemini_Kore' (Calm, bright, articulate)
       
       ElevenLabs Voices:
       - 'EXAVITQu4vr4xnSDxMaL' (Sarah - Mature, Reassuring)
       - 'FGY2WhTYpPnrIDTdsKH5' (Laura - Enthusiast, Quirky)
       - 'IKne3meq5aSn9XLyUdCD' (Charlie - Deep, Confident)
       - 'JBFqnCBsd6RMkjVDRZzb' (George - Warm Storyteller)
       - 'N2lVS1w4EtoT3dr4eOWO' (Callum - Husky Trickster)
       - 'SOYHLrjzK2X1ezoPC6cr' (Harry - Fierce Warrior)
       - 'TX3LPaxmHKxFdv7VOQHJ' (Liam - Energetic Creator)
       - 'Xb7hH8MSUJpSbSDYk0k2' (Alice - Engaging Educator)
       - 'XrExE9yKIg1WjnnlVkGX' (Matilda - Professional)


    Output ONLY a valid JSON array of objects. Example:
    [
      {{"search_query": "Rome Colosseum", "dialogue": "Rome wasn't built in a day.", "character_name": "Narrator", "voice_id": "gemini_Puck"}}
    ]

    SCRIPT:
    {script}
    """
    
    try:
        content = await generate_with_ai([{"role": "user", "content": prompt}], "")
        
        # Clean up JSON if model wrapped in markdown
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
            
        scenes = json.loads(content)
        
        # Clear old scenes
        supabase.table("reel_scenes").delete().eq("reel_id", reel_id).execute()
        
        # Insert into reel_scenes
        scene_rows = []
        for i, s in enumerate(scenes):
            scene_rows.append({
                "reel_id": reel_id,
                "scene_number": i + 1,
                "search_query": s.get("search_query", ""),
                "dialogue": s.get("dialogue", ""),
                "character_name": s.get("character_name", ""),
                "emotion_tag": s.get("emotion_tag", ""),
                "voice": s.get("voice_id", "JBFqnCBsd6RMkjVDRZzb"),
                "status": "pending"
            })
            
        supabase.table("reel_scenes").insert(scene_rows).execute()
        
        # Update reel status
        supabase.table("reels").update({"status": "prompts_ready"}).eq("id", reel_id).execute()
        print(f"[+] Successfully generated scenes for Reel {reel_id}!")
    except Exception as e:
        print(f"[-] Failed to generate scenes for reel: {e}")
        supabase.table("reels").update({"status": "error_prompts"}).eq("id", reel_id).execute()

import requests
import time

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
WAN_API_URL = os.getenv("WAN_API_URL", "http://localhost:8000/generate_video")
WAN_API_KEY = os.getenv("WAN_API_KEY", "")

# We map character names to Voice IDs (using free tier generic voices as fallbacks)
VOICE_MAP = {
    "maya": "EXAVITQu4vr4xnSDxMaL", # Sarah
    "narrator": "JBFqnCBsd6RMkjVDRZzb", # George (Warm Storyteller)
    "default": "JBFqnCBsd6RMkjVDRZzb" # George
}

async def generate_scene_audio(scene):
    scene_id = scene['id']
    ep_id = scene['episode_id']
    dialogue = scene.get("dialogue", "").strip()
    
    if not dialogue:
        supabase.table("episode_scenes").update({"status": "audio_ready"}).eq("id", scene_id).execute()
        return

    print(f"\n[+] Generating Audio for Scene {scene.get('scene_number', '?')} (ID: {scene_id})")
    
    voice = scene.get("voice")
    if not voice:
        char_name = scene.get("character_name", "").lower()
        voice = "af_bella"
    voice = voice.replace("kokoro_", "")
            
    print(f"  -> Generating Kokoro audio via RunPod for {voice}: '{dialogue[:30]}...'")
    
    runpod_key = os.getenv("RUNPOD_API_KEY")
    runpod_endpoint = os.getenv("RUNPOD_KOKORO_ENDPOINT_ID")
    
    if not runpod_endpoint or not runpod_key:
        err = "Missing RUNPOD_KOKORO_ENDPOINT_ID or RUNPOD_API_KEY in .env"
        print(f"[-] {err}")
        supabase.table("episode_scenes").update({"status": "error", "error_message": err}).eq("id", scene_id).execute()
        return

    url = f"https://api.runpod.ai/v2/{runpod_endpoint}/runsync"
    headers = {
        "Authorization": f"Bearer {runpod_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "input": {
            "text": dialogue,
            "voice": voice,
            "speed": 1.0
        }
    }
    
    import requests
    import asyncio
    try:
        r = requests.post(url, json=payload, headers=headers)
        if r.status_code == 200:
            data = r.json()
            job_id = data.get('id')
            status = data.get('status')
            
            while status in ['IN_QUEUE', 'IN_PROGRESS']:
                print(f"  -> RunPod Kokoro Job {job_id} is {status}, waiting...")
                await asyncio.sleep(2)
                poll_url = f"https://api.runpod.ai/v2/{runpod_endpoint}/status/{job_id}"
                r_poll = requests.get(poll_url, headers=headers)
                if r_poll.status_code == 200:
                    data = r_poll.json()
                    status = data.get('status')
                else:
                    break
                    
            if status == 'COMPLETED' and 'output' in data:
                audio_base64 = data['output'].get('audio_base64') or data['output'].get('audio')
                if audio_base64:
                    import base64
                    audio_bytes = base64.b64decode(audio_base64)
                    
                    storage_path = f"audio/scene_{scene_id}.mp3"
                    supabase.storage.from_("media").upload(storage_path, audio_bytes, {"content-type": "audio/mpeg", "upsert": "true"})
                    public_url = supabase.storage.from_("media").get_public_url(storage_path)
                        
                    import time
                    public_url = f"{public_url}?t={int(time.time())}"
                    supabase.table("episode_scenes").update({"status": "audio_ready", "audio_url": public_url, "error_message": None}).eq("id", scene_id).execute()
                    print(f"[+] Audio generated for Scene {scene.get('scene_number', '?')}")
                    return
                    
            err = f"RunPod Kokoro generation failed: {data}"
            print(f"[-] {err}")
            supabase.table("episode_scenes").update({"status": "error", "error_message": err}).eq("id", scene_id).execute()
        else:
            err = f"RunPod Kokoro error: {r.text}"
            print(f"[-] {err}")
            supabase.table("episode_scenes").update({"status": "error", "error_message": err}).eq("id", scene_id).execute()
    except Exception as e:
        err = f"Error calling RunPod Kokoro: {e}"
        print(f"[-] {err}")
        supabase.table("episode_scenes").update({"status": "error", "error_message": err}).eq("id", scene_id).execute()


async def generate_scene_video(scene):
    scene_id = scene['id']
    prompt = scene.get('visual_prompt', '')
    print(f"\n[+] Generating Video for Scene {scene['scene_number']} (ID: {scene_id})")
    
    # Placeholder for the generic Wan 2.6 endpoint
    print(f"  -> Sending prompt to {WAN_API_URL}: {prompt[:50]}...")
    
    try:
        # Simulate video generation delay or make actual request
        headers = {"Authorization": f"Bearer {WAN_API_KEY}"} if WAN_API_KEY else {}
        # r = requests.post(WAN_API_URL, json={"prompt": prompt}, headers=headers)
        # video_url = r.json().get("video_url")
        
        # MOCKING FOR NOW: Wait 3 seconds and just use a placeholder
        await asyncio.sleep(3)
        video_url = "https://www.w3schools.com/html/mov_bbb.mp4" # Placeholder
        
        # Update scene
        supabase.table("episode_scenes").update({"status": "video_ready", "video_url": video_url}).eq("id", scene_id).execute()
        print(f"[+] Video generated for Scene {scene['scene_number']}")
    except Exception as e:
        err = f"Error generating video: {e}"
        print(f"[-] {err}")
        supabase.table("episode_scenes").update({"status": "error", "error_message": err}).eq("id", scene_id).execute()


async def main_loop():
    global supabase
    print("YTAuto Parallel Chat Orchestrator started. Listening for pending messages and generation tasks...")
    while True:
        try:
            # Poll for pending AI messages (Episodes)
            response = supabase.table("episode_chats").select("*").eq("role", "ai").eq("status", "pending").execute()
            pending_msgs = response.data
            if pending_msgs:
                tasks = [process_chat_message(msg) for msg in pending_msgs]
                await asyncio.gather(*tasks)
                
            # Poll for pending AI messages (Reels)
            response_reels = supabase.table("reel_chats").select("*").eq("role", "ai").eq("status", "pending").execute()
            if response_reels.data:
                tasks = [process_reel_chat_message(msg) for msg in response_reels.data]
                await asyncio.gather(*tasks)
                
            # Poll for World Builder chats
            wb_chats = supabase.table("world_builder_chats").select("*").eq("status", "pending").execute()
            if wb_chats.data:
                tasks = [process_wb_chat_message(msg) for msg in wb_chats.data]
                await asyncio.gather(*tasks)
                
            # Poll for scene breakdowns (Episodes)
            ep_res = supabase.table("episodes").select("*").eq("status", "generating_prompts").execute()
            if ep_res.data:
                for ep in ep_res.data:
                    await process_scene_breakdown(ep)
                    
            # Poll for scene breakdowns (Reels)
            reel_res = supabase.table("reels").select("*").eq("status", "generating_prompts").execute()
            if reel_res.data:
                for reel in reel_res.data:
                    await process_reel_scene_breakdown(reel)
                    
            # Poll for master audio track generation (Episodes)
            master_audio_res = supabase.table("episodes").select("*").eq("status", "generating_audio").execute()
            if master_audio_res.data:
                import audio_mixer
                for ep in master_audio_res.data:
                    print(f"\n[+] Orchestrator detected Master Audio request for Episode: {ep['id']}")
                    try:
                        await audio_mixer.process_master_audio(ep['id'])
                    except Exception as e:
                        print(f"[-] Error generating master audio: {e}")
                        supabase.table("episodes").update({"status": "error_audio"}).eq("id", ep['id']).execute()
                        
            # Poll for master audio track generation (Reels)
            reel_audio_res = supabase.table("reels").select("*").eq("status", "generating_audio").execute()
            if reel_audio_res.data:
                import audio_mixer
                for reel in reel_audio_res.data:
                    print(f"\n[+] Orchestrator detected Master Audio request for Reel: {reel['id']}")
                    try:
                        await audio_mixer.process_reel_master_audio(reel['id'])
                    except Exception as e:
                        print(f"[-] Error generating master audio for reel: {e}")
                        supabase.table("reels").update({"status": "error_audio"}).eq("id", reel['id']).execute()
                        
            # Poll for BGM Application (Reels)
            bgm_apply_res = supabase.table("reels").select("*").eq("status", "applying_bgm").execute()
            if bgm_apply_res.data:
                import audio_mixer
                for reel in bgm_apply_res.data:
                    print(f"\n[+] Orchestrator detected BGM Application request for Reel: {reel['id']}")
                    try:
                        await audio_mixer.apply_bgm(reel['id'])
                    except Exception as e:
                        print(f"[-] Error applying BGM for reel: {e}")
                        supabase.table("reels").update({"status": "error_audio"}).eq("id", reel['id']).execute()
                        
            # Poll for video compilation (Reels)
            reel_compile_res = supabase.table("reels").select("*").eq("status", "compiling_video").execute()
            if reel_compile_res.data:
                import video_compiler
                for reel in reel_compile_res.data:
                    print(f"\n[+] Orchestrator detected Video Compile request for Reel: {reel['id']}")
                    try:
                        await video_compiler.compile_final_video(reel['id'])
                    except Exception as e:
                        print(f"[-] Error compiling video for reel: {e}")
                        supabase.table("reels").update({"status": "error_video"}).eq("id", reel['id']).execute()
                    
            # Poll for scene audio generation
            audio_res = supabase.table("episode_scenes").select("*").eq("status", "generating_audio").execute()
            if audio_res.data:
                for sc in audio_res.data:
                    await generate_scene_audio(sc)
                    
            # Poll for scene video generation
            vid_res = supabase.table("episode_scenes").select("*").eq("status", "generating_video").execute()
            if vid_res.data:
                for sc in vid_res.data:
                    await generate_scene_video(sc)
                    
            # Poll for scene prompt regeneration
            prompt_regen_res = supabase.table("episode_scenes").select("*").eq("status", "regenerating_prompt").execute()
            if prompt_regen_res.data:
                for sc in prompt_regen_res.data:
                    await regenerate_scene_prompt(sc)
            
            # Poll for reel scene asset generation (Wikimedia Commons)
            reel_vid_res = supabase.table("reel_scenes").select("*").eq("status", "generating_video").execute()
            if reel_vid_res.data:
                import asset_collector
                for sc in reel_vid_res.data:
                    await asset_collector.process_reel_scene_asset(sc)
                    
            # Poll for reel scene audio chunk regeneration
            reel_chunk_res = supabase.table("reel_scenes").select("*, reels!inner(id)").eq("status", "regenerating_audio").execute()
            if reel_chunk_res.data:
                import audio_mixer
                for sc in reel_chunk_res.data:
                    await audio_mixer.regenerate_reel_scene_chunk(sc)
                    
            # Poll for pending user invites
            invites_res = supabase.table("user_invites").select("*").eq("status", "pending").execute()
            if invites_res.data:
                for inv in invites_res.data:
                    try:
                        print(f"\n[+] Processing User Invite: {inv['email']}")
                        # Using the admin API to send the invite email
                        supabase.auth.admin.invite_user_by_email(inv['email'])
                        supabase.table("user_invites").update({"status": "invited"}).eq("id", inv["id"]).execute()
                        print(f"  -> Invite sent to {inv['email']}")
                    except Exception as e:
                        print(f"  -> Invite Error: {e}")
                        supabase.table("user_invites").update({"status": "error"}).eq("id", inv["id"]).execute()

        # Poll for voice preview requests
            preview_res = supabase.table("voice_preview_requests").select("*").eq("status", "pending").execute()
            if preview_res.data:
                pass
                # import audio_mixer
                # for req in preview_res.data:
                #     await audio_mixer.process_voice_preview(req)
                    
            # Poll for TTS Utility jobs
            tts_res = supabase.table("tts_jobs").select("*").eq("status", "pending").execute()
            if tts_res.data:
                import audio_mixer
                for job in tts_res.data:
                    try:
                        print(f"\n[+] Processing TTS Job: {job['id']}")
                        node = {
                            "type": "voice",
                            "voice": job['voice_id'],
                            "dialogue": job['text_content']
                        }
                        node = await audio_mixer.generate_voice(node)
                        
                        if "audio_bytes" in node:
                            import tempfile
                            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_file:
                                temp_file.write(node["audio_bytes"])
                                temp_file_path = temp_file.name
                            
                            try:
                                supabase_path = f"audio/tts_{job['id']}.mp3"
                                with open(temp_file_path, "rb") as f:
                                    supabase.storage.from_("media").upload(
                                        path=supabase_path,
                                        file=f,
                                        file_options={"content-type": "audio/mpeg"}
                                    )
                                
                                public_url = supabase.storage.from_("media").get_public_url(supabase_path)
                                supabase.table("tts_jobs").update({"status": "completed", "audio_url": public_url}).eq("id", job["id"]).execute()
                                print(f"  -> TTS Job Completed! URL: {public_url}")
                            finally:
                                os.remove(temp_file_path)
                        else:
                            raise Exception("Failed to generate audio bytes")
                    except Exception as e:
                        print(f"  -> TTS Job Error: {e}")
                        supabase.table("tts_jobs").update({"status": "error"}).eq("id", job["id"]).execute()
                    
        except Exception as e:
            print(f"Error polling database: {e}")
            try:
                # Reconnect if connection terminated
                supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            except:
                pass
            
        await asyncio.sleep(2)

if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        print("\nShutting down orchestrator.")
