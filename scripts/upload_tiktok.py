#!/usr/bin/env python3
"""
TikTok video uploader using Playwright directly.
No third-party uploader libraries - we control every step.

Usage:
    python3 upload_tiktok.py '{"video": "/path/video.mp4", "description": "text", "cookies": "/path/cookies.txt"}'

Outputs:
    {"status": "ok"} on success
    {"status": "error", "message": "..."} on failure
"""
import sys
import json
import time
import http.cookiejar
from pathlib import Path


def log(step: str, detail: str = '') -> None:
    ts = time.strftime('%H:%M:%S')
    msg = f'[{ts}] {step}'
    if detail:
        msg += f': {detail}'
    print(msg, file=sys.stderr)


def load_netscape_cookies(cookies_path: str) -> list[dict]:
    """Parse Netscape/Mozilla cookie file into Playwright-compatible dicts.
    Never logs cookie values.
    """
    jar = http.cookiejar.MozillaCookieJar()
    try:
        jar.load(cookies_path, ignore_discard=True, ignore_expires=True)
    except Exception as e:
        raise RuntimeError(f'Failed to load cookies from {cookies_path}: {e}')

    cookies = []
    for c in jar:
        cookie: dict = {
            'name': c.name,
            'value': c.value,
            'domain': c.domain,
            'path': c.path,
        }
        if c.expires:
            cookie['expires'] = float(c.expires)
        if c.secure:
            cookie['secure'] = True
        cookies.append(cookie)

    log('Cookies loaded', f'{len(cookies)} cookies from file (values not logged)')
    return cookies


def dismiss_modal_if_present(page) -> None:
    """Dismiss TikTok copyright/interactivity/notification modals that block the upload flow.
    Loops until no more modals are found so stacked dialogs are all cleared.
    """
    dismiss_selectors = [
        'button:has-text("Got it")',
        'button:has-text("Confirm")',
        'button:has-text("OK")',
        'button:has-text("I understand")',
        'button:has-text("Cancel")',          # "Turn on notifications" modal — decline
        'button[aria-label="Close"]',
        '[data-e2e="modal-close-inner-button"]',
    ]
    dismissed_any = True
    while dismissed_any:
        dismissed_any = False
        for sel in dismiss_selectors:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=800):
                    log('Modal dismissed', sel)
                    btn.click()
                    page.wait_for_timeout(500)
                    dismissed_any = True
                    break  # restart loop to catch stacked modals
            except Exception:
                pass


def wait_for_overlay_gone(page, timeout_ms: int = 15_000) -> None:
    """Wait until TikTok's overlay modal is no longer intercepting pointer events."""
    try:
        page.wait_for_selector(
            '.TUXModal-overlay',
            state='hidden',
            timeout=timeout_ms,
        )
        log('Overlay cleared')
    except Exception:
        # Overlay may not exist or already gone
        pass


def upload(video_path: str, description: str, cookies_path: str) -> None:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        raise RuntimeError('playwright not installed. Run: pip3 install playwright && playwright install chromium')

    log('Starting TikTok upload', Path(video_path).name)

    cookies = load_netscape_cookies(cookies_path)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/122.0.0.0 Safari/537.36'
            ),
            viewport={'width': 1280, 'height': 900},
        )

        # Inject cookies without logging values
        valid_cookies = []
        skipped = 0
        for c in cookies:
            try:
                context.add_cookies([c])
                valid_cookies.append(c['name'])
            except Exception:
                skipped += 1
        log('Cookies injected', f'{len(valid_cookies)} ok, {skipped} skipped')

        page = context.new_page()

        log('Navigating to upload page')
        page.goto('https://www.tiktok.com/creator-center/upload?lang=en', timeout=30_000)
        page.wait_for_load_state('domcontentloaded')
        log('Page loaded')

        # Check if we're actually logged in (look for auth indicators)
        try:
            page.wait_for_selector(
                'input[type="file"], [data-e2e="upload-btn"]',
                timeout=10_000,
            )
            log('Upload zone visible - authenticated')
        except PlaywrightTimeout:
            # Check if redirected to login
            if 'login' in page.url or 'passport' in page.url:
                raise RuntimeError('Not authenticated - cookies may be expired. Re-extract from Arc.')
            log('Upload zone not found, continuing anyway')

        # Step 1: Upload the video file
        log('Uploading video file')
        file_input = page.locator('input[type="file"]').first
        file_input.set_input_files(video_path)
        log('File set, waiting for processing')

        # Wait for upload progress to start
        try:
            page.wait_for_selector(
                '[data-e2e="upload_status_container"], [class*="upload-progress"], video',
                timeout=30_000,
            )
            log('Video processing started')
        except PlaywrightTimeout:
            log('Progress indicator not found, continuing')

        # Step 2: Dismiss any modals that appear during/after upload
        page.wait_for_timeout(3_000)
        dismiss_modal_if_present(page)
        wait_for_overlay_gone(page, timeout_ms=8_000)

        # Step 3: Set description/caption
        log('Setting description')
        caption_sel = '[data-e2e="caption_container"] div[contenteditable="true"]'
        caption_sel_fallback = 'div[contenteditable="true"]'
        try:
            caption = page.locator(caption_sel).first
            if not caption.is_visible(timeout=5_000):
                caption = page.locator(caption_sel_fallback).first
            caption.wait_for(state='visible', timeout=30_000)
            # Clear existing content and type
            caption.click()
            page.keyboard.press('Meta+A')
            page.keyboard.press('Backspace')
            page.wait_for_timeout(300)
            page.keyboard.type(description, delay=30)
            log('Description set', f'{len(description)} chars')
        except PlaywrightTimeout:
            log('WARNING: Caption field not found, posting without description')

        # Dismiss any modal that appeared after clicking description
        dismiss_modal_if_present(page)
        wait_for_overlay_gone(page, timeout_ms=5_000)

        # Step 3b: Enable AI-generated content label
        # The AI label section is hidden behind "Show more" in advanced settings
        log('Setting AI content disclosure label')
        try:
            # First, expand advanced settings to reveal the AI label section
            show_more = page.locator('[data-e2e="advanced_settings_container"]')
            try:
                if show_more.is_visible(timeout=3_000):
                    show_more.click()
                    log('Expanded advanced settings')
                    page.wait_for_timeout(1_000)
            except Exception:
                pass

            # Target the AI-generated content container specifically
            aigc = page.locator('[data-e2e="aigc_container"]')
            toggled = False
            try:
                if aigc.is_visible(timeout=5_000):
                    # Find the switch input inside the aigc container
                    switch = aigc.locator('input[role="switch"]').first
                    if switch.is_visible(timeout=2_000):
                        is_checked = 'checked-true' in (switch.evaluate('e => e.className') or '')
                        if not is_checked:
                            switch.click()
                            log('AI label toggled ON', 'aigc_container >> input[role=switch]')
                        else:
                            log('AI label already ON')
                        toggled = True
            except Exception:
                pass

            # Fallback: try broader selectors if aigc container wasn't found
            if not toggled:
                ai_selectors = [
                    '[data-e2e="aigc_container"] [class*="Switch__input"]',
                    'div:has-text("AI-generated content") >> input[role="switch"]',
                    'div:has-text("AI-generated") >> [class*="switch"]',
                ]
                for sel in ai_selectors:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=2000):
                            el.click()
                            log('AI label toggled ON', sel)
                            page.wait_for_timeout(500)
                            toggled = True
                            break
                    except Exception:
                        pass

            if not toggled:
                log('WARNING: AI content label toggle NOT FOUND — video may be suppressed by TikTok')
        except Exception as e:
            log('WARNING: AI label step FAILED — video may be suppressed', str(e)[:120])

        dismiss_modal_if_present(page)

        # Step 4: Wait for video to finish server-side processing
        log('Waiting for video processing to complete')
        post_btn_sel = 'button[data-e2e="post_video_button"]'
        try:
            page.wait_for_selector(
                f'{post_btn_sel}:not([disabled])',
                timeout=120_000,
            )
            log('Video processing complete, Post button active')
        except PlaywrightTimeout:
            log('WARNING: Timed out waiting for Post button - attempting anyway')

        # Final modal check before posting
        dismiss_modal_if_present(page)

        # Step 5: Click Post
        log('Clicking Post button')
        try:
            post_btn = page.locator(post_btn_sel)
            post_btn.click(timeout=10_000)
        except Exception as e:
            # Fallback: find by exact text match via JS
            log('Primary post click failed, trying fallback', str(e)[:60])
            page.evaluate("""
                const btn = document.querySelector('[data-e2e="post_video_button"]')
                    || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Post' && !b.disabled);
                if (btn) btn.click();
            """)

        # Step 6: Wait for confirmation of successful post
        log('Waiting for post confirmation')
        try:
            page.wait_for_selector(
                '[class*="success"], [data-e2e="upload-success"], '
                ':has-text("Your video is being uploaded"), :has-text("Video uploaded")',
                timeout=30_000,
            )
            log('Post confirmed - upload successful')
        except PlaywrightTimeout:
            # Check URL changed (TikTok often redirects after successful post)
            current_url = page.url
            if 'upload' not in current_url or 'success' in current_url:
                log('URL changed after post - likely successful', current_url[:60])
            else:
                log('WARNING: Success confirmation not found, post may have failed')

        browser.close()
        log('Browser closed')


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({'status': 'error', 'message': 'No args provided'}))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({'status': 'error', 'message': f'Invalid JSON args: {e}'}))
        sys.exit(1)

    video = args.get('video', '')
    description = args.get('description', '')
    cookies = args.get('cookies', '')

    if not video or not Path(video).exists():
        print(json.dumps({'status': 'error', 'message': f'Video file not found: {video}'}))
        sys.exit(1)

    if not cookies or not Path(cookies).exists():
        print(json.dumps({'status': 'error', 'message': f'Cookies file not found: {cookies}'}))
        sys.exit(1)

    try:
        upload(video, description, cookies)
        print(json.dumps({'status': 'ok'}))
    except Exception as e:
        log('Upload failed', str(e))
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
