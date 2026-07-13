import sqlite3
import os
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), "ytdashboard.db")

@contextmanager
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.commit()
        conn.close()

def init_db():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Stories Table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS stories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            logline TEXT,
            lore_context TEXT,
            status TEXT DEFAULT 'Draft',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Scenes Table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            story_id INTEGER,
            sequence_number INTEGER,
            narration_text TEXT,
            visual_description TEXT,
            character_focus TEXT,
            status TEXT DEFAULT 'Draft',
            approved_at DATETIME,
            FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
        )
        ''')
        
        # Audio Clips Table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS audio_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id INTEGER,
            voice_id TEXT,
            file_path TEXT,
            duration REAL,
            status TEXT DEFAULT 'Pending',
            FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
        )
        ''')
        
        # Video Clips Table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS video_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id INTEGER,
            runpod_job_id TEXT,
            prompt_weights TEXT,
            file_path TEXT,
            status TEXT DEFAULT 'Pending',
            rendered_at DATETIME,
            FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
        )
        ''')
        
if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
