with open("modal_video_editor.py", "r") as f:
    content = f.read()

target = """                # Step 5a: Parallellize AI captioning by extracting frames immediately from the RAW video
                raw_grid_path = f"/tmp/grid_{job_id}.jpg"
                try:
                    extract_6_frames_grid(input_media_path, raw_grid_path, media_duration)
                    files_to_clean.append(raw_grid_path)
                except Exception as grid_err:
                    print(f"[{job_id}] Grid extraction failed: {grid_err}, using fallback single frame.")
                    raw_grid_path = input_media_path"""

replacement = """                # Step 5a: Parallellize AI captioning by extracting frames immediately from the RAW video
                if media_type == "image":
                    print(f"[{job_id}] Input is an image, skipping 6-frame grid extraction.")
                    raw_grid_path = input_media_path
                else:
                    raw_grid_path = f"/tmp/grid_{job_id}.jpg"
                    try:
                        extract_6_frames_grid(input_media_path, raw_grid_path, media_duration)
                        files_to_clean.append(raw_grid_path)
                    except Exception as grid_err:
                        print(f"[{job_id}] Grid extraction failed: {grid_err}, using fallback single frame.")
                        raw_grid_path = input_media_path"""

if target in content:
    with open("modal_video_editor.py", "w") as f:
        f.write(content.replace(target, replacement))
    print("Patched successfully")
else:
    print("Target not found")
