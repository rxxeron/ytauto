import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

def get_client():
    if not GEMINI_API_KEY:
        return None
    return genai.Client(api_key=GEMINI_API_KEY)

def generate_script_draft(story_title, logline, lore_context, num_scenes=3):
    client = get_client()
    if not client:
        return f"[MOCK] Generated draft script for {story_title}. Please set GEMINI_API_KEY."
        
    prompt = f"""
    You are an expert anime and YouTube short scriptwriter.
    Story Title: {story_title}
    Logline: {logline}
    Context/Lore: {lore_context}
    
    Generate a {num_scenes}-scene script. 
    Format each scene clearly with:
    - Sequence Number
    - Narration Text
    - Visual Description (Highly descriptive for an AI image/video generator like Wan 2.6)
    - Character Focus
    
    Output strictly in a structured format so it can be parsed easily.
    """
    
    try:
        # Use gemini-3.5-flash as it's the latest cheap and fast model
        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=prompt,
        )
        return response.text
    except Exception as e:
        return f"Error generating script: {str(e)}"

def cross_check_script(script_text):
    client = get_client()
    if not client:
        return "[MOCK] Script audited. Visuals look consistent."
        
    prompt = f"""
    You are an expert AI video auditor. Review the following script for visual consistency, pacing, and prompt quality for Wan 2.6 (ComfyUI).
    Check if a character's clothing or key features accidentally change description between scenes.
    
    Script:
    {script_text}
    
    Provide a concise audit report.
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=prompt,
        )
        return response.text
    except Exception as e:
        return f"Error auditing script: {str(e)}"
