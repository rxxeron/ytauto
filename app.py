import streamlit as st
import db
import pandas as pd
import ai_client
import orchestrator
from daemon import daemon
import os

st.set_page_config(page_title="Directors' Board", layout="wide")

# Start background daemon
daemon.start()

def main():
    st.sidebar.title("🎥 YTAuto Dashboard")
    page = st.sidebar.radio("Navigation", [
        "1. Lore & Story Planner",
        "2. AI Scriptwriter & Auditor",
        "3. Production & Rendering",
        "4. Settings & Budget"
    ])
    
    # Ensure DB is initialized
    if not os.path.exists(db.DB_PATH):
        db.init_db()

    if page == "1. Lore & Story Planner":
        render_story_planner()
    elif page == "2. AI Scriptwriter & Auditor":
        render_scriptwriter()
    elif page == "3. Production & Rendering":
        render_production()
    elif page == "4. Settings & Budget":
        render_settings()

def render_story_planner():
    st.header("📖 Lore & Story Planner")
    
    with st.expander("➕ Create New Story", expanded=True):
        title = st.text_input("Story Title")
        logline = st.text_area("Logline")
        lore = st.text_area("Lore / Character Context (JSON or Text)")
        if st.button("Save Story"):
            with db.get_db_connection() as conn:
                conn.execute(
                    "INSERT INTO stories (title, logline, lore_context) VALUES (?, ?, ?)",
                    (title, logline, lore)
                )
            st.success("Story created successfully!")
            
    st.subheader("Existing Stories")
    with db.get_db_connection() as conn:
        df = pd.read_sql_query("SELECT id, title, logline, status, created_at FROM stories", conn)
        st.dataframe(df, use_container_width=True)

def render_scriptwriter():
    st.header("✍️ AI Scriptwriter & Auditor (HITL)")
    
    with db.get_db_connection() as conn:
        stories = conn.execute("SELECT id, title, logline, lore_context FROM stories").fetchall()
        
    if not stories:
        st.warning("No stories found. Create a story first.")
        return
        
    story_options = {f"{s['id']}: {s['title']}": s for s in stories}
    selected_story_key = st.selectbox("Select Story", list(story_options.keys()))
    selected_story = story_options[selected_story_key]
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("Draft Script")
        num_scenes = st.slider("Number of Scenes", 1, 10, 3)
        if st.button("Generate Script with Gemini"):
            with st.spinner("Generating..."):
                draft = ai_client.generate_script_draft(
                    selected_story['title'], 
                    selected_story['logline'], 
                    selected_story['lore_context'],
                    num_scenes
                )
                st.session_state['current_draft'] = draft
                
        draft_text = st.text_area("Script Draft", value=st.session_state.get('current_draft', ''), height=400)
        
    with col2:
        st.subheader("Cross-Check & Audit")
        if st.button("Audit Script with Gemini"):
            if 'current_draft' in st.session_state and st.session_state['current_draft']:
                with st.spinner("Auditing..."):
                    audit_result = ai_client.cross_check_script(st.session_state['current_draft'])
                    st.session_state['audit_result'] = audit_result
            else:
                st.error("Generate a script first.")
                
        st.text_area("Audit Report", value=st.session_state.get('audit_result', ''), height=400)
        
    if st.button("Approve & Save Scenes"):
        st.info("In a full implementation, this would parse the script and insert individual scenes into the `scenes` DB table.")

def render_production():
    st.header("🎬 Production & Rendering")
    st.write("Orchestrate RunPod and ElevenLabs here.")
    st.info(f"Mock Mode is currently: {'ON' if orchestrator.MOCK_MODE else 'OFF'}")
    
    if st.button("Simulate Render Job"):
        with st.spinner("Triggering audio generation..."):
            audio_res = orchestrator.generate_audio(1, "Test text", "voice_1")
            st.write(audio_res)
        with st.spinner("Triggering RunPod job..."):
            runpod_res = orchestrator.start_runpod_job(1, "Test prompt", audio_res["file_path"])
            st.write(runpod_res)
        with st.spinner("Checking job status..."):
            status_res = orchestrator.check_runpod_status(runpod_res["job_id"])
            st.write(status_res)
            
def render_settings():
    st.header("⚙️ Settings & Budget")
    
    st.subheader("Environment Configuration")
    import os
    st.text_input("GEMINI_API_KEY", value=os.getenv("GEMINI_API_KEY", ""), type="password", disabled=True)
    st.text_input("RUNPOD_API_KEY", value=os.getenv("RUNPOD_API_KEY", ""), type="password", disabled=True)
    st.text_input("ELEVENLABS_API_KEY", value=os.getenv("ELEVENLABS_API_KEY", ""), type="password", disabled=True)
    st.write("*(Update these values in your `.env` file)*")
    
    st.subheader("Mock Mode Status")
    st.write(f"**{'🟢 Active' if orchestrator.MOCK_MODE else '🔴 Inactive'}** - Cost-free simulation mode.")
    
if __name__ == "__main__":
    import os # ensure os is imported
    main()
