#!/usr/bin/env python3
"""
TikTok profile setup via Playwright.
Sets bio, avatar, and username for a creator account.

Usage:
    python3 setup_tiktok_profile.py '{
        "cookies": "/path/cookies.txt",
        "bio": "Datos curiosos del mundo 🌍 | IA | Ciencia",
        "username": "optional_new_username",
        "avatar": "/path/avatar.jpg"
    }'

Outputs:
    {"status": "ok", "updated": ["bio", "avatar"]} on success
    {"status": "error", "message": "..."} on failure
"""
import sys
import json
import time
import http.cookiejar
from pathlib import Path
from typing import Optional, List


def log(step: str, detail: str = '') -> None:
    ts = time.strftime('%H:%M:%S')
    msg = f'[{ts}] {step}'
    if detail:
        msg += f': {detail}'
    print(msg, file=sys.stderr)


def load_netscape_cookies(cookies_path: str) -> List[dict]:
    jar = http.cookiejar.MozillaCookieJar()
    jar.load(cookies_path, ignore_discard=True, ignore_expires=True)
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
    log('Cookies loaded', f'{len(cookies)} cookies (values not logged)')
    return cookies


def setup_profile(cookies_path: str, bio: Optional[str], username: Optional[str], avatar: Optional[str]) -> List[str]:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        raise RuntimeError('playwright not installed. Run: pip3 install playwright && playwright install chromium')

    cookies = load_netscape_cookies(cookies_path)
    updated: List[str] = []

    with sync_playwright() as p:
        # headless=False: avoids TikTok bot detection; works on macOS even via SSH
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/122.0.0.0 Safari/537.36'
            ),
            viewport={'width': 1280, 'height': 900},
        )

        skipped = 0
        for c in cookies:
            try:
                context.add_cookies([c])
            except Exception:
                skipped += 1
        log('Cookies injected', f'{len(cookies) - skipped} ok, {skipped} skipped')

        page = context.new_page()

        log('Navigating to own profile page')
        # TikTok's "Edit profile" button lives on the user's own profile page
        page.goto('https://www.tiktok.com/tiktokstudio', timeout=30_000)
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(5_000)

        if 'login' in page.url or 'passport' in page.url:
            raise RuntimeError('Not authenticated - cookies may be expired')

        # Extract username from the page body (first line is the username in TikTok Studio)
        body_text = page.inner_text('body')
        username = body_text.split('\n')[0].strip() if body_text else 'unknown'
        log('Detected username', username)

        # Navigate to own profile page
        page.goto(f'https://www.tiktok.com/@{username}', timeout=30_000)
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(5_000)
        log('Profile page loaded', page.url[:60])

        # Click "Edit profile" button — TikTok shows this on your own profile page
        try:
            edit_btn = page.locator('button:has-text("Edit profile")').first
            edit_btn.wait_for(state='visible', timeout=10_000)
            edit_btn.click()
            page.wait_for_timeout(3_000)
            log('Clicked Edit profile', page.url[:60])
        except Exception as e:
            # Fallback: JS click
            try:
                page.evaluate("""
                    const btns = [...document.querySelectorAll('button')];
                    const edit = btns.find(b => b.textContent.trim() === 'Edit profile');
                    if (edit) edit.click();
                """)
                page.wait_for_timeout(3_000)
                log('Clicked Edit profile via JS fallback')
            except Exception as e2:
                log('Could not click Edit profile button', str(e2)[:60])

        # Set bio
        if bio:
            log('Setting bio')
            try:
                bio_selectors = [
                    'textarea[placeholder*="bio" i]',
                    'textarea[data-e2e="bio-input"]',
                    '[data-e2e="profile-bio"] textarea',
                    'textarea[placeholder*="introduce" i]',
                    'textarea[placeholder*="yourself" i]',
                    'textarea[maxlength]',
                    'textarea',
                ]
                for sel in bio_selectors:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=3000):
                            el.click()
                            page.keyboard.press('Control+A')
                            page.keyboard.press('Delete')
                            page.keyboard.type(bio, delay=20)
                            log('Bio typed', f'{len(bio)} chars')
                            updated.append('bio')
                            break
                    except Exception:
                        pass
            except Exception as e:
                log('Bio set failed', str(e)[:60])

        # Set avatar
        if avatar and Path(avatar).exists():
            log('Uploading avatar')
            try:
                avatar_selectors = [
                    'input[type="file"][accept*="image"]',
                    '[data-e2e="avatar-upload"] input',
                    '[class*="avatar"] input[type="file"]',
                ]
                for sel in avatar_selectors:
                    try:
                        el = page.locator(sel).first
                        if el.count() > 0:
                            el.set_input_files(avatar)
                            page.wait_for_timeout(3000)
                            log('Avatar uploaded')
                            updated.append('avatar')
                            break
                    except Exception:
                        pass
                if 'avatar' not in updated:
                    log('Avatar input not found, skipping')
            except Exception as e:
                log('Avatar upload failed', str(e)[:60])

        # Set username
        if username:
            log('Setting username', username)
            try:
                user_selectors = [
                    'input[placeholder*="username" i]',
                    'input[data-e2e="username-input"]',
                    '[data-e2e="profile-username"] input',
                ]
                for sel in user_selectors:
                    try:
                        el = page.locator(sel).first
                        if el.is_visible(timeout=3000):
                            el.click()
                            page.keyboard.press('Control+A')
                            page.keyboard.type(username, delay=20)
                            log('Username typed')
                            updated.append('username')
                            break
                    except Exception:
                        pass
            except Exception as e:
                log('Username set failed', str(e)[:60])

        # Save
        if updated:
            log('Saving profile changes')
            try:
                save_selectors = [
                    'button:has-text("Save")',
                    'button:has-text("Guardar")',
                    '[data-e2e="save-btn"]',
                    'button[type="submit"]',
                ]
                saved = False
                for sel in save_selectors:
                    try:
                        btn = page.locator(sel).first
                        if btn.is_visible(timeout=3000):
                            btn.click()
                            page.wait_for_timeout(3000)
                            log('Saved')
                            saved = True
                            break
                    except Exception:
                        pass
                if not saved:
                    log('Save button not found')
            except Exception as e:
                log('Save failed', str(e)[:60])
        else:
            log('Nothing to update')

        browser.close()

    return updated


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({'status': 'error', 'message': 'No args provided'}))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({'status': 'error', 'message': f'Invalid JSON: {e}'}))
        sys.exit(1)

    cookies = args.get('cookies', '')
    if not cookies or not Path(cookies).exists():
        print(json.dumps({'status': 'error', 'message': f'Cookies file not found: {cookies}'}))
        sys.exit(1)

    bio = args.get('bio')
    username = args.get('username')
    avatar = args.get('avatar')

    try:
        updated = setup_profile(cookies, bio, username, avatar)
        print(json.dumps({'status': 'ok', 'updated': updated}))
    except Exception as e:
        log('Profile setup failed', str(e))
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
