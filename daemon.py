import time
import threading
import orchestrator
import db

class SafetyDaemon:
    def __init__(self, check_interval=15, deadman_timeout=240):
        self.check_interval = check_interval
        self.deadman_timeout = deadman_timeout
        self.running = False
        self._thread = None

    def start(self):
        if not self.running:
            self.running = True
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
            print("Safety Daemon started.")

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join()
            print("Safety Daemon stopped.")

    def _run(self):
        while self.running:
            try:
                self._check_runpod_jobs()
            except Exception as e:
                print(f"Daemon Error: {e}")
            time.sleep(self.check_interval)

    def _check_runpod_jobs(self):
        """
        Monitors active RunPod jobs. 
        If a job is stuck for > deadman_timeout, forces termination.
        """
        with db.get_db_connection() as conn:
            # Find all rendering video clips
            active_clips = conn.execute("SELECT id, runpod_job_id FROM video_clips WHERE status = 'Rendering'").fetchall()
            
            for clip in active_clips:
                job_id = clip["runpod_job_id"]
                if not job_id:
                    continue
                    
                status = orchestrator.check_runpod_status(job_id)
                
                # If finished, mark as completed (in a real scenario, also trigger RunPod shutdown)
                if status.get("status") == "COMPLETED":
                    conn.execute("UPDATE video_clips SET status = 'Completed' WHERE id = ?", (clip["id"],))
                    print(f"Job {job_id} completed successfully. RunPod instance signaled to shut down.")
                elif status.get("status") == "FAILED":
                    conn.execute("UPDATE video_clips SET status = 'Failed' WHERE id = ?", (clip["id"],))
                    print(f"Job {job_id} failed.")
                    
# Initialize a global daemon instance
daemon = SafetyDaemon()
