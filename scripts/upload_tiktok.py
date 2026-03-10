#!/opt/homebrew/bin/python3.11
import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "No args provided"}))
        sys.exit(1)

    args = json.loads(sys.argv[1])
    video = args.get('video')
    description = args.get('description', '')
    cookies = args.get('cookies')

    try:
        from tiktok_uploader.upload import upload_video
        upload_video(
            video=video,
            description=description,
            cookies=cookies,
            headless=True
        )
        print(json.dumps({"status": "ok"}))
    except ImportError:
        print(json.dumps({"status": "error", "message": "tiktok_uploader not installed"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
