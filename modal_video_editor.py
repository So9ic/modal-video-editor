import os
import sys
import json
import time
import base64
import textwrap
import subprocess
import requests
import threading
from PIL import Image, ImageDraw, ImageFont
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
import modal

# -----------------------------------------------------------------------------
# 1. MODAL IMAGE & APP DEFINITION (EXACT COPIED PIPELINE FROM televideditor.py)
# -----------------------------------------------------------------------------
auth_file_path = os.path.expanduser("~/.codex/auth.json")
font_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Montserrat-ExtraBold.ttf")

image_builder = (
    modal.Image.debian_slim()
    .apt_install("ffmpeg", "fonts-freefont-ttf", "curl")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs"
    )
    .pip_install("requests", "pillow", "openai", "fastapi[standard]")
    .run_commands("npm install -g openai-oauth@latest")
)

if os.path.exists(auth_file_path):
    image_builder = image_builder.add_local_file(auth_file_path, remote_path="/root/.codex/auth.json")

if os.path.exists(font_file_path):
    image_builder = image_builder.add_local_file(font_file_path, remote_path="/root/Montserrat-ExtraBold.ttf")
    image_builder = image_builder.add_local_file(font_file_path, remote_path="/Montserrat-ExtraBold.ttf")

image = image_builder

app = modal.App("televideditor-modal", image=image)

# In-memory dictionary on Modal for tracking Telegram user interaction states
user_states = modal.Dict.from_name("televideditor-user-states", create_if_missing=True)

# -----------------------------------------------------------------------------
# 2. EXACT VIDEO PROCESSING CONSTANTS FROM televideditor.py
# -----------------------------------------------------------------------------
COMP_WIDTH = 1080
COMP_HEIGHT = 1920
COMP_SIZE_STR = f"{COMP_WIDTH}x{COMP_HEIGHT}"
BACKGROUND_COLOR = "black"
FPS = 30
IMAGE_DURATION = 8
FADE_IN_DURATION = 6
MEDIA_Y_OFFSET = 100
CAPTION_V_PADDING = 37
CAPTION_FONT_SIZE = 55
CAPTION_TOP_PADDING_LINES = 0
CAPTION_LINE_SPACING = 12
CAPTION_FONT = "Montserrat-ExtraBold"
CAPTION_TEXT_COLOR = (0, 0, 0)
CAPTION_BG_COLOR = (255, 255, 255)

DOWNLOAD_PATH = "/tmp/downloads"
OUTPUT_PATH = "/tmp/outputs"



# -----------------------------------------------------------------------------
# 3. HELPER FUNCTIONS (BLIND COPY FROM televideditor.py)
# -----------------------------------------------------------------------------
def ensure_directories():
    for p in [DOWNLOAD_PATH, OUTPUT_PATH]:
        os.makedirs(p, exist_ok=True)

def cleanup_files(file_list):
    for f in file_list:
        if f and os.path.exists(f):
            try:
                os.remove(f)
            except Exception:
                pass

def download_telegram_file(file_id: str, job_id: str, bot_token: str, media_type: str = "video") -> str:
    ensure_directories()
    if file_id.startswith("http://") or file_id.startswith("https://"):
        ext = ".mp4" if media_type == "video" else ".jpg"
        save_path = os.path.join(DOWNLOAD_PATH, f"{job_id}{ext}")
        with requests.get(file_id, stream=True, timeout=30) as r:
            r.raise_for_status()
            with open(save_path, "wb") as f:
                for chunk in r.iter_content(8192):
                    f.write(chunk)
        return save_path

    info_url = f"https://api.telegram.org/bot{bot_token}/getFile"
    res = requests.get(info_url, params={"file_id": file_id}, timeout=15).json()
    if not res.get("ok"):
        raise RuntimeError(f"Telegram getFile failed: {res.get('description', 'Unknown error')}")
    file_path = res["result"]["file_path"]
    ext = os.path.splitext(file_path)[1]
    save_path = os.path.join(DOWNLOAD_PATH, f"{job_id}{ext}")

    download_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path}"
    with requests.get(download_url, stream=True, timeout=30) as r:
        r.raise_for_status()
        with open(save_path, "wb") as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)

    return save_path

def get_media_dimensions(media_path, media_type):
    if media_type == 'image':
        with Image.open(media_path) as img:
            return img.width, img.height, IMAGE_DURATION
    else: # video
        command = ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration', '-of', 'json', media_path]
        try:
            result = subprocess.run(command, capture_output=True, text=True, check=True, timeout=30)
            data = json.loads(result.stdout)['streams'][0]
            width = data['width']
            height = data['height']
            duration = data.get('duration')

            # Fallback: query format-level duration if stream duration is missing
            if duration is None:
                fmt_cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', media_path]
                fmt_result = subprocess.run(fmt_cmd, capture_output=True, text=True, check=True, timeout=15)
                fmt_data = json.loads(fmt_result.stdout)
                duration = fmt_data.get('format', {}).get('duration')

            if duration is None:
                print(f"FFprobe: no duration found in stream or format metadata")
                return None, None, None

            return width, height, float(duration)
        except Exception as e:
            print(f"FFprobe failed: {e}")
            return None, None, None

def has_audio_stream(media_path):
    """Check if a media file contains at least one audio stream."""
    try:
        cmd = ['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries',
               'stream=index', '-of', 'json', media_path]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=15)
        data = json.loads(result.stdout)
        return len(data.get('streams', [])) > 0
    except Exception:
        return False

def create_caption_image(text, job_id):
    """EXACT COPY OF create_caption_image FROM televideditor.py"""
    padded_text = ("\n" * CAPTION_TOP_PADDING_LINES) + text
    
    font_path = "/root/Montserrat-ExtraBold.ttf"
    if not os.path.exists(font_path):
        font_path = "/Montserrat-ExtraBold.ttf"
    if not os.path.exists(font_path):
        font_path = "Montserrat-ExtraBold.ttf"

    font = ImageFont.truetype(font_path, CAPTION_FONT_SIZE)
    final_lines = [item for line in padded_text.split('\n') for item in textwrap.wrap(line, width=30, break_long_words=True) or ['']]
    wrapped_text = "\n".join(final_lines)
    dummy_draw = ImageDraw.Draw(Image.new('RGB', (0,0)))
    text_bbox = dummy_draw.multiline_textbbox((0, 0), wrapped_text, font=font, align="center", spacing=CAPTION_LINE_SPACING)
    text_height = text_bbox[3] - text_bbox[1]
    rect_height = text_height + (2 * CAPTION_V_PADDING) + 6  # extra buffer for font descenders
    img = Image.new('RGBA', (COMP_WIDTH, int(rect_height)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([(0, 0), (COMP_WIDTH, int(rect_height))], fill=CAPTION_BG_COLOR)
    draw.multiline_text((COMP_WIDTH / 2, int(rect_height) / 2), wrapped_text, font=font, fill=CAPTION_TEXT_COLOR, anchor="mm", align="center", spacing=CAPTION_LINE_SPACING)
    caption_image_path = os.path.join(OUTPUT_PATH, f"caption_{job_id}.png")
    img.save(caption_image_path)
    return caption_image_path, rect_height

# -----------------------------------------------------------------------------
# 4. 6-FRAME 2x3 GRID EXTRACTION & LOCALHOST IMAGE SERVING VISION AI TRICK
# -----------------------------------------------------------------------------
def extract_6_frames_grid(video_path: str, duration: float, job_id: str) -> tuple[str, list[str]]:
    """
    Extracts 6 evenly-spaced JPEG frames across the video and stitches them
    into a single 2-row x 3-column composite grid image.
    Returns (grid_image_path, temp_files_to_clean).
    """
    frame_paths = []
    temp_files = []
    
    for i in range(6):
        fraction = (i + 0.5) / 6.0
        timestamp = max(0.0, duration * fraction)
        f_path = os.path.join(OUTPUT_PATH, f"frame_{job_id}_{i+1}.jpg")
        cmd = ["ffmpeg", "-y", "-ss", f"{timestamp:.2f}", "-i", video_path, "-vframes", "1", "-q:v", "2", f_path]
        subprocess.run(cmd, capture_output=True, check=True)
        frame_paths.append(f_path)
        temp_files.append(f_path)

    # Load extracted frames to get dimensions
    frames = [Image.open(fp) for fp in frame_paths]
    w, h = frames[0].size

    # Scale cell resolution down to ~540x960 if full-res is high to keep grid size optimal (~1620x1920 total)
    w_cell, h_cell = (w // 2, h // 2) if w > 600 else (w, h)
    grid_img = Image.new("RGB", (w_cell * 3, h_cell * 2))

    for i, frame in enumerate(frames):
        col = i % 3
        row = i // 3
        if (w_cell, h_cell) != (w, h):
            resized_frame = frame.resize((w_cell, h_cell), Image.Resampling.LANCZOS)
            grid_img.paste(resized_frame, (col * w_cell, row * h_cell))
        else:
            grid_img.paste(frame, (col * w_cell, row * h_cell))
        frame.close()

    grid_path = os.path.join(OUTPUT_PATH, f"grid_{job_id}.jpg")
    grid_img.save(grid_path, "JPEG", quality=90)
    grid_img.close()

    temp_files.append(grid_path)
    return grid_path, temp_files

def upload_single_frame_to_telegram_cdn(file_path: str, bot_token: str, chat_id: int) -> str:
    """Uploads a single frame JPEG to Telegram CDN and returns direct public HTTPS URL."""
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    with open(file_path, "rb") as f:
        res = requests.post(url, data={"chat_id": chat_id}, files={"photo": ("frame.jpg", f, "image/jpeg")}, timeout=30).json()
    
    if not res.get("ok"):
        raise RuntimeError(f"Telegram sendPhoto failed: {res.get('description', res)}")
    
    file_id = res["result"]["photo"][-1]["file_id"]
    msg_id = res["result"]["message_id"]

    # Delete temporary photo message from Telegram chat so it doesn't clutter chat
    try:
        requests.post(f"https://api.telegram.org/bot{bot_token}/deleteMessage", json={"chat_id": chat_id, "message_id": msg_id}, timeout=10)
    except Exception:
        pass

    info_res = requests.get(f"https://api.telegram.org/bot{bot_token}/getFile", params={"file_id": file_id}, timeout=15).json()
    if not info_res.get("ok"):
        raise RuntimeError(f"Telegram getFile failed: {info_res.get('description', info_res)}")

    file_path_tg = info_res["result"]["file_path"]
    
    cdn_url = f"https://api.telegram.org/file/bot{bot_token}/{file_path_tg}"
    return cdn_url

def generate_multi_frame_ai_caption(grid_path: str | list[str], bot_token: str, chat_id: int, extra_details: str = "") -> str:
    """
    Ultra-Fast Single-Request 2x3 Grid Vision AI:
    Uploads stitched 2x3 grid image to Telegram CDN, launches local openai-oauth proxy
    explicitly referencing --oauth-file /root/.codex/auth.json, and calls http://127.0.0.1:10531/v1
    (gpt-5.5) for 100% FREE AI Vision!
    """
    if isinstance(grid_path, list):
        grid_path = grid_path[0]

    print(f"[Modal AI] Uploading 2x3 grid frame image to Telegram CDN...")
    cdn_url = upload_single_frame_to_telegram_cdn(grid_path, bot_token, chat_id)
    print(f"[Modal AI] Grid Frame Telegram CDN URL: {cdn_url}")

    image_payloads = [{
        "type": "image_url",
        "image_url": {"url": cdn_url}
    }]

    auth_file = "/root/.codex/auth.json"
    if not os.path.exists(auth_file):
        auth_file = os.path.expanduser("~/.codex/auth.json")

    env = dict(os.environ)
    env["NO_PROXY"] = "127.0.0.1,localhost,::1"
    env["no_proxy"] = "127.0.0.1,localhost,::1"

    proxy_proc = None
    proxy_already_running = False

    # Check if proxy is already running and responsive on port 10531
    try:
        r = requests.get("http://127.0.0.1:10531/v1/models", timeout=1)
        if r.status_code == 200:
            print("[Modal AI Proxy] Existing openai-oauth proxy detected and online!")
            proxy_already_running = True
    except Exception:
        pass

    if not proxy_already_running:
        # Kill any lingering zombie proxy process before starting a new instance
        try:
            subprocess.run(["pkill", "-9", "-f", "openai-oauth"], capture_output=True)
            time.sleep(0.5)
        except Exception:
            pass

        print(f"[Modal AI] Launching embedded openai-oauth proxy with --oauth-file {auth_file}...")
        proxy_proc = subprocess.Popen(
            ["openai-oauth", "--oauth-file", auth_file, "--no-open"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )

        # Wait up to 10 seconds to ensure server port 10531 is bound
        online = False
        for _ in range(20):
            time.sleep(0.5)
            poll_code = proxy_proc.poll()
            if poll_code is not None:
                stdout, stderr = proxy_proc.communicate()
                print(f"[Modal AI Proxy Error] Exited with code {poll_code}!\nSTDOUT: {stdout}\nSTDERR: {stderr}")
                raise RuntimeError(f"openai-oauth exited early with code {poll_code}: {stderr or stdout}")

            try:
                r = requests.get("http://127.0.0.1:10531/v1/models", timeout=1)
                if r.status_code == 200:
                    print("[Modal AI Proxy] openai-oauth proxy is online!")
                    online = True
                    break
            except Exception:
                pass

        if not online:
            raise RuntimeError("openai-oauth proxy failed to start on port 10531 within timeout.")

    try:
        from openai import OpenAI
        client = OpenAI(base_url="http://127.0.0.1:10531/v1", api_key="not-needed")

        extra_context_block = ""
        if extra_details and extra_details.strip():
            extra_context_block = (
                f"\n\nADDITIONAL USER CONTEXT & DETAILS:\n"
                f"The creator provided the following specific background notes about what is happening in this video:\n"
                f"\"{extra_details.strip()}\"\n"
                f"Carefully incorporate and reference these user-provided details into your story deduction and explanation. "
                f"Use this context to ensure 100% precision in your scientific, technical, or meme breakdown, while keeping your tone effortlessly cool and engaging."
            )

        prompt = (
            "Developer: You are a cool, witty, Gen-Z viral content creator and meme/science explainer for Instagram Reels.\n"
            "You are analyzing a video clip provided as a single composite image containing 6 chronological visual keyframes arranged in a 2-row by 3-column grid (Top row left-to-right: frames 1, 2, 3; Bottom row left-to-right: frames 4, 5, 6).\n"
            "Some keyframes may capture slight motion blur or transition states—use your intuition to deduce the complete story, joke, or scientific phenomenon happening in the video from frame 1 through frame 6."
            f"{extra_context_block}\n\n"
            "PERSONALITY & STYLE:\n"
            "- Tone: Effortlessly cool, witty, modern Reddit/Gen-Z vibe (e.g. 'lowkey', 'bro really thought', 'living rent free', subtle sarcasm). Keep it natural, sharp, and relatable—never cringe or forced.\n"
            "- Explanation style: Simple, fascinating, and 100% accurate. Break down the real science, engineering, physics, or meme lore behind the clip so anyone understands it instantly.\n\n"
            "CRITICAL DIRECTIVES:\n"
            "1. NEVER mention words like 'frames', 'grid', 'snapshots', 'images', 'screenshots', 'slides', 'pictures', or 'still images'. Speak naturally about 'the video', 'the clip', or the action.\n"
            "2. Follow the EXACT format below:\n\n"
            "[Witty, modern Gen-Z / Reddit-style opening line or sarcastic observation about what happens in the video clip.]\n"
            "---------------------------------------\n"
            "➡️ Explanation:\n"
            "----------------\n"
            "[Provide a simple, clear, and genuinely informative breakdown of the real science, concept, or meme lore behind the video.]\n"
            "---------------------------------------\n"
            "[10 trending, relevant hashtags space-separated, e.g., #science #viral #fyp #explorepage #memes]\n\n"
            "Rules:\n"
            "- Strictly maintain the separator lines (---------------------------------------).\n"
            "- Plain text only. Do NOT use markdown bold/italic asterisks or hyphens inside the text body."
        )

        res = client.chat.completions.create(
            model="gpt-5.5",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        *image_payloads
                    ]
                }
            ],
            timeout=90
        )

        return res.choices[0].message.content.strip()
    finally:
        if proxy_proc and proxy_proc.poll() is None:
            proxy_proc.terminate()
            try:
                proxy_proc.wait(timeout=2)
            except Exception:
                proxy_proc.kill()

# -----------------------------------------------------------------------------
# 5. ASYNCHRONOUS HEAVY RENDERING & BOT PIPELINE ON MODAL
# -----------------------------------------------------------------------------
@app.function(timeout=600, secrets=[modal.Secret.from_name("telegram-video-bot-secrets")])
def process_video_job_async(chat_id: int, job_data: dict):
    bot_token = os.environ.get("BOT_TOKEN")
    job_id = job_data["job_id"]
    caption_text = job_data["caption_text"]
    apply_fade = job_data.get("apply_fade", True)
    media_type = job_data.get("media_type", "video")
    job_start_time = job_data.get("start_time", time.time())

    files_to_clean = []

    try:
        # Step 1: Download Media from Telegram
        print(f"[{job_id}] Downloading media file...")
        media_path = download_telegram_file(job_data["file_id"], job_id, bot_token, media_type)
        if not media_path:
            raise ValueError("Media download failed.")
        files_to_clean.append(media_path)

        # Backup raw user media & raw caption text asynchronously via Storage Bot (Non-blocking daemon thread)
        storage_bot_token = os.environ.get("STORAGE_BOT_TOKEN")
        if storage_bot_token:
            def storage_backup_worker(path_to_send=media_path):
                print(f"[{job_id}] [Async Storage Thread] Sending raw input backup via Storage Bot...")
                try:
                    endpoint = "sendPhoto" if media_type == "image" else "sendVideo"
                    file_key = "photo" if media_type == "image" else "video"
                    mime = "image/jpeg" if media_type == "image" else "video/mp4"
                    ext = os.path.splitext(path_to_send)[1]

                    with open(path_to_send, "rb") as mf:
                        requests.post(
                            f"https://api.telegram.org/bot{storage_bot_token}/{endpoint}",
                            data={"chat_id": chat_id},
                            files={file_key: (f"raw_input{ext}", mf, mime)},
                            timeout=60
                        )

                    if caption_text:
                        requests.post(
                            f"https://api.telegram.org/bot{storage_bot_token}/sendMessage",
                            json={"chat_id": chat_id, "text": caption_text},
                            timeout=15
                        )
                    print(f"[{job_id}] [Async Storage Thread] Raw backup completed!")
                except Exception as s_err:
                    print(f"[{job_id}] [Async Storage Thread Error] {s_err}")

            t_storage = threading.Thread(target=storage_backup_worker, daemon=True)
            t_storage.start()

        media_w, media_h, final_duration = get_media_dimensions(media_path, media_type)
        if not all([media_w, media_h, final_duration]):
            raise ValueError("Could not get media dimensions via ffprobe.")

        # Step 2: Generate Pillow White Banner Caption PNG (EXACT televideditor.py)
        caption_img_path, caption_height = create_caption_image(caption_text, job_id)
        files_to_clean.append(caption_img_path)

        output_filepath = os.path.join(OUTPUT_PATH, f"output_{job_id}.mp4")
        files_to_clean.append(output_filepath)

        # Step 3: EXACT Position & Layer Math (BLIND COPY FROM televideditor.py)
        scale_ratio = COMP_WIDTH / media_w
        scaled_media_h = (int(media_h * scale_ratio) // 2) * 2
        fade_canvas_h = scaled_media_h + 2
        media_y_pos = (COMP_HEIGHT / 2 - scaled_media_h / 2) + MEDIA_Y_OFFSET
        caption_y_pos = media_y_pos - caption_height + 1

        # Step 4: EXACT FFmpeg Assembly (BLIND COPY FROM televideditor.py)
        command = ['ffmpeg', '-y', '-f', 'lavfi', '-i', f'color=c={BACKGROUND_COLOR}:s={COMP_SIZE_STR}:d={final_duration}']
        if media_type == 'image':
            command.extend(['-loop', '1', '-t', str(final_duration)])
        command.extend(['-i', media_path, '-i', caption_img_path])

        filter_parts = [f"[1:v]scale={COMP_WIDTH}:-2,setpts=PTS-STARTPTS[scaled_media]"]
        media_layer = "[scaled_media]"

        if apply_fade:
            filter_parts.extend([
                f"color=c=black:s={COMP_WIDTH}x{fade_canvas_h}:d={final_duration},format=rgba,fade=t=out:st=0:d={min(FADE_IN_DURATION, final_duration)}[fade_layer]",
                f"[scaled_media][fade_layer]overlay=0:0[media_with_fade]"
            ])
            media_layer = "[media_with_fade]"

        filter_parts.extend([
            f"[0:v]{media_layer}overlay=(W-w)/2:{media_y_pos}[bg_with_media]",
            f"[bg_with_media][2:v]overlay=(W-w)/2:{caption_y_pos}[final_v]"
        ])

        filter_complex = ";".join(filter_parts)
        map_args = ['-map', '[final_v]']

        if media_type == 'video' and has_audio_stream(media_path):
            filter_complex += ";[1:a]asetpts=PTS-STARTPTS[final_a]"
            map_args.extend(['-map', '[final_a]'])

        command.extend([
            '-filter_complex', filter_complex,
            *map_args,
            '-c:v', 'libx264',
            '-preset', 'superfast',
            '-tune', 'zerolatency',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-r', str(FPS),
            '-pix_fmt', 'yuv420p',
            output_filepath
        ])

        print(f"[{job_id}] Rendering video with FFmpeg...")
        res = subprocess.run(command, capture_output=True, text=True, timeout=300)
        if res.returncode != 0:
            print(f"[{job_id}] FFmpeg Error: {res.stderr}")
            raise subprocess.CalledProcessError(res.returncode, command, stderr=res.stderr)

        print(f"[{job_id}] Video rendered successfully.")

        # Step 5: Extract 6 Evenly-Spaced Frames & Stitch into 2x3 Grid for AI Vision
        grid_path, temp_frame_files = extract_6_frames_grid(output_filepath, final_duration, job_id)
        files_to_clean.extend(temp_frame_files)

        # Step 6: Send Final Video to Telegram User
        print(f"[{job_id}] Sending final video to Telegram...")
        with open(output_filepath, "rb") as vf:
            res_v = requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendVideo",
                data={"chat_id": chat_id, "caption": "✅ Your video is ready!"},
                files={"video": ("final_video.mp4", vf, "video/mp4")},
                timeout=120
            ).json()
            print(f"[{job_id}] Telegram sendVideo response: {res_v.get('ok')}")

        video_done_time = time.time()
        render_elapsed = video_done_time - job_start_time

        # Step 7: Generate & Send 6-Frame 2x3 Grid AI Caption
        extra_details = job_data.get("extra_details", "")
        print(f"[{job_id}] Generating AI Caption using 2x3 grid Vision trick (Free ChatGPT via Telegram CDN)...")
        ai_start_time = time.time()
        try:
            ai_caption = generate_multi_frame_ai_caption(grid_path, bot_token, chat_id, extra_details=extra_details)
            ai_elapsed = time.time() - ai_start_time
            total_elapsed = time.time() - job_start_time

            caption_msg = (
                f"✅ *AI Caption Generated:*\n\n"
                f"```\n{ai_caption}\n```\n\n"
                f"⏱️ *Execution Time Summary:*\n"
                f"• Video Processing: `{render_elapsed:.2f}s`\n"
                f"• AI Vision Captioning: `{ai_elapsed:.2f}s`\n"
                f"• *Total End-to-End Time:* `{total_elapsed:.2f}s`"
            )
            res_c = requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={"chat_id": chat_id, "text": caption_msg, "parse_mode": "Markdown"},
                timeout=30
            ).json()
            print(f"[{job_id}] Telegram sendMessage response: {res_c.get('ok')}")
        except Exception as ai_err:
            print(f"[{job_id}] AI Vision generation error: {ai_err}")
            total_elapsed = time.time() - job_start_time
            requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": f"⚠️ Video ready in `{render_elapsed:.2f}s`, but AI caption failed: {ai_err}\n\n⏱️ Total Time: `{total_elapsed:.2f}s`",
                    "parse_mode": "Markdown"
                }
            )

        # Step 8: Clean up all prior intermediate chat messages
        msg_ids_to_delete = job_data.get("msg_ids_to_delete", [])
        if msg_ids_to_delete:
            print(f"[{job_id}] Cleaning up {len(msg_ids_to_delete)} intermediate Telegram chat messages...")
            try:
                res_del = requests.post(
                    f"https://api.telegram.org/bot{bot_token}/deleteMessages",
                    json={"chat_id": chat_id, "message_ids": msg_ids_to_delete},
                    timeout=10
                ).json()
                if not res_del.get("ok"):
                    for m_id in msg_ids_to_delete:
                        try:
                            requests.post(
                                f"https://api.telegram.org/bot{bot_token}/deleteMessage",
                                json={"chat_id": chat_id, "message_id": m_id},
                                timeout=5
                            )
                        except Exception:
                            pass
            except Exception as del_err:
                print(f"[{job_id}] Message cleanup error: {del_err}")

    except Exception as err:
        print(f"[{job_id}] Error in video pipeline: {err}")
        requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": f"❌ Video processing failed: {err}"}
        )
    finally:
        cleanup_files(files_to_clean)

# -----------------------------------------------------------------------------
# 6. MODAL FASTAPI ENDPOINT (TELEGRAM BOT INTERACTIVE STATE MACHINE)
# -----------------------------------------------------------------------------
@app.function(secrets=[modal.Secret.from_name("telegram-video-bot-secrets")])
@modal.fastapi_endpoint(method="POST")
def telegram_webhook(payload: dict):
    bot_token = os.environ.get("BOT_TOKEN")
    
    message = payload.get("message") or payload.get("callback_query", {}).get("message")
    callback_query = payload.get("callback_query")

    if not message and not callback_query:
        return {"status": "ok"}

    chat_id = message["chat"]["id"]
    chat_key = str(chat_id)

    # Access Control: Only respond to authorized chat ID 6371392863
    ALLOWED_CHAT_ID = 6371392863
    if str(chat_id) != str(ALLOWED_CHAT_ID):
        print(f"[Access Control] Ignored update from unauthorized chat_id: {chat_id}")
        return {"status": "ignored"}

    # Answer callback query if present
    if callback_query:
        requests.post(
            f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery",
            json={"callback_query_id": callback_query["id"]}
        )

    user_state = user_states.get(chat_key, {"state": "idle", "msg_ids_to_delete": []})
    msg_ids_to_delete = list(user_state.get("msg_ids_to_delete", []))

    def track_msg(item):
        if not item:
            return
        if isinstance(item, dict):
            mid = item.get("result", {}).get("message_id") or item.get("message_id")
            if mid and mid not in msg_ids_to_delete:
                msg_ids_to_delete.append(mid)

    msg = payload.get("message", {})
    if msg.get("message_id"):
        track_msg(msg)

    # Handle /cancel or /reset command
    text_content = msg.get("text", "").strip()
    if text_content in ["/cancel", "/reset"]:
        user_states.pop(chat_key, None)
        requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": "❌ Session cancelled. Send an image or video to start a new job."}
        )
        return {"status": "ok"}

    # Handle /start command
    if msg.get("text") == "/start":
        res = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": "Hello! Please send an image or video to begin."}
        ).json()
        track_msg(res)
        user_states[chat_key] = {"state": "awaiting_media", "msg_ids_to_delete": msg_ids_to_delete}
        return {"status": "ok"}

    # Handle incoming Photo/Video
    file_id = None
    media_type = None

    if msg.get("photo"):
        media_type = "image"
        file_id = msg["photo"][-1]["file_id"]
    elif msg.get("video"):
        media_type = "video"
        file_id = msg["video"]["file_id"]
    elif msg.get("document"):
        doc = msg["document"]
        mime = doc.get("mime_type", "")
        if mime.startswith("video/"):
            media_type = "video"
            file_id = doc["file_id"]

    if file_id and media_type:
        res = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": "✅ Media received! Now, please send the caption text."}
        ).json()
        track_msg(res)
        user_states[chat_key] = {
            "state": "awaiting_caption",
            "file_id": file_id,
            "media_type": media_type,
            "msg_ids_to_delete": msg_ids_to_delete
        }
        return {"status": "ok"}

    # Handle Caption Text Submission
    if user_state.get("state") == "awaiting_caption" and msg.get("text"):
        user_state["caption_text"] = msg["text"]
        user_state["state"] = "awaiting_fade_choice"

        # Show inline keyboard buttons for fade option
        inline_kb = {
            "inline_keyboard": [
                [
                    {"text": "Yes", "callback_data": "fade_yes"},
                    {"text": "No", "callback_data": "fade_no"}
                ]
            ]
        }
        res = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": "Apply a fade-in effect?",
                "reply_markup": inline_kb
            }
        ).json()
        track_msg(res)
        user_state["msg_ids_to_delete"] = msg_ids_to_delete
        user_states[chat_key] = user_state
        return {"status": "ok"}

    # Handle Fade Option Callback
    if user_state.get("state") == "awaiting_fade_choice" and callback_query:
        cb_data = callback_query.get("data")
        if cb_data in ["fade_yes", "fade_no"]:
            user_state["apply_fade"] = (cb_data == "fade_yes")
            user_state["state"] = "awaiting_extra_details"

            # Edit the fade question message to show user's choice
            cb_msg_id = callback_query.get("message", {}).get("message_id")
            fade_text = "Yes" if cb_data == "fade_yes" else "No"
            if cb_msg_id:
                requests.post(
                    f"https://api.telegram.org/bot{bot_token}/editMessageText",
                    json={
                        "chat_id": chat_id,
                        "message_id": cb_msg_id,
                        "text": f"✅ Apply fade: *{fade_text}*",
                        "parse_mode": "Markdown"
                    }
                )

            # Prompt user for optional extra video details
            res = requests.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": "📝 Any extra context for this video?",
                    "parse_mode": "Markdown"
                }
            ).json()
            track_msg(res)
            user_state["msg_ids_to_delete"] = msg_ids_to_delete
            user_states[chat_key] = user_state
            return {"status": "ok"}

    # Handle Extra Video Details Submission
    if user_state.get("state") == "awaiting_extra_details" and msg.get("text"):
        input_text = msg["text"].strip()
        clean_text = input_text.lower()

        if clean_text in ["skip", "no", "none", "n/a"] or clean_text.startswith("skip") or clean_text.startswith("no"):
            user_state["extra_details"] = ""
        else:
            user_state["extra_details"] = input_text

        user_state["job_id"] = f"{chat_id}_{int(time.time())}"
        user_state["start_time"] = time.time()

        # Notify user video cooking has started
        res = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": "✅ Cooking your video..."}
        ).json()
        track_msg(res)
        user_state["msg_ids_to_delete"] = msg_ids_to_delete

        # Spawn heavy video processing asynchronously on Modal
        process_video_job_async.spawn(chat_id, user_state)

        # Reset user state
        user_states.pop(chat_key, None)
        return {"status": "processing_started"}

    return {"status": "ok"}

# -----------------------------------------------------------------------------
# 7. MODAL LOCAL ENTRYPOINT FOR INSTANT LOCAL TESTING ON MODAL CONTAINER
# -----------------------------------------------------------------------------
@app.function(secrets=[modal.Secret.from_name("telegram-video-bot-secrets")])
def test_ai_vision_remote():
    """Remote runner for testing Vision AI inside Modal container directly from terminal."""
    ensure_directories()
    bot_token = os.environ.get("BOT_TOKEN", "")
    sample_frame = os.path.join(OUTPUT_PATH, "sample_test_frame.jpg")
    img = Image.new("RGB", (600, 600), color=(73, 109, 137))
    d = ImageDraw.Draw(img)
    d.text((100, 250), "Test Science Video Frame", fill=(255, 255, 0))
    img.save(sample_frame, "JPEG")
    
    print(f"[Remote Test] Created sample frame at {sample_frame}")
    return generate_multi_frame_ai_caption(sample_frame, bot_token=bot_token, chat_id=0)

@app.local_entrypoint()
def main():
    print("Testing Vision AI proxy inside Modal remote environment...")
    result = test_ai_vision_remote.remote()
    print("\n==========================================")
    print("      SUCCESSFUL RESULT FROM MODAL AI     ")
    print("==========================================")
    print(result)
