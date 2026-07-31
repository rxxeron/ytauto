import os
import requests
import json
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()

CLIENT_ID = os.getenv("GDRIVE_CLIENT_ID")
CLIENT_SECRET = os.getenv("GDRIVE_CLIENT_SECRET")
REFRESH_TOKEN = os.getenv("GDRIVE_REFRESH_TOKEN")
GDRIVE_FOLDER_ID = os.getenv("GDRIVE_FOLDER_ID", "15jxYYViGaJV18gAOmbO2ibheru4VdzlL")

def get_access_token():
    url = "https://oauth2.googleapis.com/token"
    payload = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
        "grant_type": "refresh_token"
    }
    try:
        r = requests.post(url, data=payload, timeout=15)
        if r.status_code == 200:
            return r.json().get("access_token")
        else:
            print(f"[-] Failed to get Google OAuth access token: {r.status_code} {r.text}")
            return None
    except Exception as e:
        print(f"[-] Error fetching Google access token: {e}")
        return None

def upload_file_to_gdrive(local_file_path, file_name=None, folder_id=GDRIVE_FOLDER_ID):
    if not os.path.exists(local_file_path):
        print(f"[-] Local file not found for Google Drive upload: {local_file_path}")
        return None

    access_token = get_access_token()
    if not access_token:
        print("[-] Missing Google Drive Access Token")
        return None

    if not file_name:
        file_name = os.path.basename(local_file_path)

    metadata = {
        "name": file_name,
        "parents": [folder_id]
    }

    url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
    headers = {"Authorization": f"Bearer {access_token}"}

    files = {
        "data": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
        "file": (file_name, open(local_file_path, "rb"), "video/mp4")
    }

    print(f"  -> Uploading '{file_name}' ({os.path.getsize(local_file_path)/(1024*1024):.2f} MB) to Google Drive Folder: {folder_id}...")

    try:
        r = requests.post(url, headers=headers, files=files, timeout=120)
        if r.status_code == 200:
            res_data = r.json()
            file_id = res_data.get("id")
            
            # Make file publicly readable
            perm_url = f"https://www.googleapis.com/drive/v3/files/{file_id}/permissions"
            requests.post(perm_url, headers=headers, json={"role": "reader", "type": "anyone"}, timeout=10)

            drive_view_url = f"https://drive.google.com/file/d/{file_id}/view"
            print(f"[+] Successfully uploaded to Google Drive! File ID: {file_id}")
            print(f"[+] Google Drive View Link: {drive_view_url}")
            return {
                "file_id": file_id,
                "drive_view_url": drive_view_url,
                "download_url": f"https://drive.google.com/uc?export=download&id={file_id}"
            }
        else:
            print(f"[-] Google Drive Upload Error: {r.status_code} {r.text}")
            return None
    except Exception as e:
        print(f"[-] Exception during Google Drive upload: {e}")
        return None

def auto_cleanup_old_gdrive_files(folder_id=GDRIVE_FOLDER_ID, max_age_days=14):
    access_token = get_access_token()
    if not access_token:
        return

    cutoff_date = (datetime.utcnow() - timedelta(days=max_age_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    query = f"'{folder_id}' in parents and createdTime < '{cutoff_date}' and trashed = false"

    url = f"https://www.googleapis.com/drive/v3/files?q={requests.utils.quote(query)}&fields=files(id,name,createdTime)"
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        r = requests.get(url, headers=headers, timeout=20)
        if r.status_code == 200:
            files = r.json().get("files", [])
            if not files:
                print(f"  -> Google Drive Cleanup: No files older than {max_age_days} days found.")
                return

            print(f"  -> Google Drive Cleanup: Found {len(files)} file(s) older than {max_age_days} days. Purging...")
            for f in files:
                del_url = f"https://www.googleapis.com/drive/v3/files/{f['id']}"
                dr = requests.delete(del_url, headers=headers, timeout=10)
                if dr.status_code in [200, 204]:
                    print(f"    [x] Deleted old file: {f['name']} (ID: {f['id']}, Created: {f['createdTime']})")
        else:
            print(f"[-] Failed to query old Google Drive files: {r.status_code} {r.text}")
    except Exception as e:
        print(f"[-] Exception during Google Drive cleanup: {e}")

if __name__ == "__main__":
    print("Testing Google Drive Uploader Module...")
    auto_cleanup_old_gdrive_files()
