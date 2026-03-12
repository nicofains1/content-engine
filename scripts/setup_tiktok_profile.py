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


def log(step: str, detail: str = '') -> None:
    ts = time.strftime('%H:%M:%S')
    msg = f'[{ts}] {step}'
    if detail:
        msg += f': {detail}'
    print(msg, file=sys.stderr)


def load_netscape_cookies(cookies_path: str) -> list[dict]:
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


def setup_profile(cookies_path: str, bio: str | None, username: str | None, avatar: str | None) -> list[str]:
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        raise RuntimeError('playwright not installed. Run: pip3 install playwright && playwright install chromium')

    cookies = load_netscape_cookies(cookies_path)
    updated: list[str] = []

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

        skipped = 0
        for c in cookies:
            try:
                context.add_cookies([c])
            except Exception:
                skipped += 1
        log('Cookies injected', f'{len(cookies) - skipped} ok, {skipped} skipped')

        page = context.new_page()

        log('Navigating to profile edit page')
        page.goto('https://www.tiktok.com/profile/edit', timeout=30_000)
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(3_000)

        if 'login' in page.url or 'passport' in page.url:
            raise RuntimeError('Not authenticated - cookies may be expired')

        log('Profile edit page loaded', page.url[:60])

        # Set bio
        if bio:
            log('Setting bio')
            try:
                bio_selectors = [
                    'textarea[placeholder*="bio" i]',
                    'textarea[data-e2e="bio-input"]',
                    '[data-e2e="profile-bio"] textarea',
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
