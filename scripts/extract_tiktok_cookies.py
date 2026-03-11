#!/usr/bin/env python3
"""
Extract TikTok cookies from Arc browser on macOS.
Handles both v10 (AES-128-CBC) and v11 (AES-256-GCM) encrypted cookies.
Outputs a Netscape-format cookies.txt file.
"""
import os
import sys
import json
import sqlite3
import shutil
import tempfile
import subprocess
from pathlib import Path

try:
    from Crypto.Cipher import AES
    from Crypto.Protocol.KDF import PBKDF2
except ImportError:
    print("Installing pycryptodome...", file=sys.stderr)
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pycryptodome', '-q'])
    from Crypto.Cipher import AES
    from Crypto.Protocol.KDF import PBKDF2


def get_keychain_password(service_name: str) -> bytes:
    """Retrieve encryption password from macOS Keychain."""
    result = subprocess.run(
        ['security', 'find-generic-password', '-w', '-s', service_name],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"Keychain lookup failed for '{service_name}': {result.stderr.strip()}")
    return result.stdout.strip().encode()


def derive_key(password: bytes, key_length: int) -> bytes:
    """Derive AES key using PBKDF2 with Chrome's parameters."""
    return PBKDF2(password, b'saltysalt', dkLen=key_length, count=1003)


def _strip_binary_prefix(raw: bytes) -> str:
    """Strip binary header bytes that some Arc/Chromium versions prepend to cookie values.

    After decryption the plaintext may start with ~16-32 bytes of binary metadata
    before the actual ASCII cookie value. This operates on the raw bytes directly
    to avoid UTF-8 replacement char expansion confusing the search offsets.

    Strategy:
    1. Look for 32+ consecutive lowercase hex bytes (sessionid, odin_tt, etc.)
    2. Fall back to first 8+ bytes of printable URL-safe ASCII (msToken, ttwid, etc.)
    """
    import re
    # Work in ASCII/latin-1 to avoid UTF-8 multi-byte expansion
    s = raw.decode('latin-1')
    # Priority: pure lowercase hex (32+ chars) - typical for TikTok session tokens
    m = re.search(r'[0-9a-f]{32,}', s)
    if m:
        # Return from the start of the hex match to end of decoded string
        return s[m.start():]
    # Fallback: first long run of URL-safe printable ASCII
    m = re.search(r'[a-zA-Z0-9%_\-\.;=+@:!/]{8,}', s)
    if m:
        return s[m.start():]
    return s


def decrypt_cookie(encrypted_value: bytes, key_v10: bytes, key_v11: bytes) -> str:
    """Decrypt a cookie value supporting both v10 and v11 formats."""
    if encrypted_value[:3] == b'v11':
        # AES-256-GCM: IV is bytes 3:15, ciphertext is bytes 15:-16, tag is last 16 bytes
        iv = encrypted_value[3:15]
        ciphertext = encrypted_value[15:-16]
        tag = encrypted_value[-16:]
        try:
            cipher = AES.new(key_v11, AES.MODE_GCM, nonce=iv)
            decrypted = cipher.decrypt_and_verify(ciphertext, tag)
            return decrypted.decode('utf-8', errors='replace')
        except Exception:
            return ''
    elif encrypted_value[:3] == b'v10':
        # Try 1: Arc embeds the IV in bytes 3:19, ciphertext starts at 19
        # (some Arc/Chromium versions use random per-cookie IVs instead of 16 spaces)
        if len(encrypted_value) > 19:
            try:
                iv_embedded = encrypted_value[3:19]
                ct_embedded = encrypted_value[19:]
                if len(ct_embedded) % 16 == 0:
                    cipher = AES.new(key_v10, AES.MODE_CBC, IV=iv_embedded)
                    raw = cipher.decrypt(ct_embedded)
                    pad_len = raw[-1]
                    if 1 <= pad_len <= 16:
                        raw = raw[:-pad_len]
                    result = raw.decode('utf-8', errors='replace')
                    # Valid if it's clean printable ASCII (no replacement chars at start)
                    if result and all(ord(c) < 128 and c.isprintable() for c in result[:8]):
                        return result
            except Exception:
                pass

        # Try 2: Standard Chrome v10 - IV = 16 spaces, ciphertext at byte 3
        # Arc may prepend a binary metadata header to the plaintext; strip it.
        try:
            iv = b' ' * 16
            ciphertext = encrypted_value[3:]
            cipher = AES.new(key_v10, AES.MODE_CBC, IV=iv)
            raw = cipher.decrypt(ciphertext)
            pad_len = raw[-1]
            if 1 <= pad_len <= 16:
                raw = raw[:-pad_len]
            return _strip_binary_prefix(raw)
        except Exception:
            return ''
    else:
        # Unencrypted
        try:
            return encrypted_value.decode('utf-8', errors='replace')
        except Exception:
            return ''


def find_arc_cookies_db() -> Path:
    """Find Arc browser's Cookies SQLite database with most TikTok cookies."""
    base = Path.home() / 'Library' / 'Application Support' / 'Arc' / 'User Data'
    best_path = None
    best_count = -1
    for cookies_path in base.rglob('Cookies'):
        if not cookies_path.is_file():
            continue
        try:
            tmp = tempfile.mktemp(suffix='.db')
            shutil.copy2(cookies_path, tmp)
            conn = sqlite3.connect(tmp)
            count = conn.execute("SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%tiktok.com%'").fetchone()[0]
            conn.close()
            os.unlink(tmp)
            if count > best_count:
                best_count = count
                best_path = cookies_path
        except Exception:
            pass
    if best_path is None:
        raise FileNotFoundError(f"Arc Cookies DB not found under {base}")
    print(f"Using profile with {best_count} TikTok cookies: {best_path}", file=sys.stderr)
    return best_path


def extract_tiktok_cookies(output_path: str):
    """Extract TikTok cookies and write Netscape cookies.txt."""
    # Get keychain password
    try:
        password = get_keychain_password('Arc Safe Storage')
    except RuntimeError:
        try:
            password = get_keychain_password('Chromium Safe Storage')
        except RuntimeError:
            password = b'peanuts'  # fallback for older versions

    key_v10 = derive_key(password, 16)
    key_v11 = derive_key(password, 32)

    # Find and copy cookies DB (Arc locks it)
    cookies_db = find_arc_cookies_db()
    print(f"Found cookies DB: {cookies_db}", file=sys.stderr)

    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
        tmp_path = tmp.name
    shutil.copy2(cookies_db, tmp_path)

    try:
        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("""
            SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly
            FROM cookies
            WHERE host_key LIKE '%tiktok.com%'
            ORDER BY name
        """)
        rows = cursor.fetchall()
        conn.close()
    finally:
        os.unlink(tmp_path)

    print(f"Found {len(rows)} TikTok cookies in DB", file=sys.stderr)

    cookies = []
    important = ['sessionid', 'sid_ucp_v1', 'ssid_ucp_v1', 'odin_tt', 'ttwid', 'tt_csrf_token',
                 'passport_csrf_token', 'tt_chain_token', 'msToken', 'sid_tt']

    for row in rows:
        name = row['name']
        encrypted = bytes(row['encrypted_value'])
        value = decrypt_cookie(encrypted, key_v10, key_v11) if encrypted else ''

        if name in important:
            status = 'OK' if value else 'EMPTY'
            print(f"  {status}: {name} = {value[:50] if value else '(empty)'}...", file=sys.stderr)

        # Convert Chrome epoch (microseconds since 1601) to Unix timestamp
        expires_utc = row['expires_utc']
        if expires_utc and expires_utc > 0:
            unix_ts = (expires_utc - 11644473600000000) // 1000000
        else:
            unix_ts = 0

        host = row['host_key']
        # Netscape format: domain, flag, path, secure, expiry, name, value
        include_subdomains = 'TRUE' if host.startswith('.') else 'FALSE'
        is_secure = 'TRUE' if row['is_secure'] else 'FALSE'

        cookies.append(
            f"{host}\t{include_subdomains}\t{row['path']}\t{is_secure}\t{unix_ts}\t{name}\t{value}"
        )

    with open(output_path, 'w') as f:
        f.write("# Netscape HTTP Cookie File\n")
        f.write("# https://curl.haxx.se/docs/http-cookies.html\n")
        f.write("# This file was generated by extract_tiktok_cookies.py\n\n")
        for line in cookies:
            f.write(line + '\n')

    print(f"\nWrote {len(cookies)} cookies to {output_path}", file=sys.stderr)

    # Report on important cookies
    missing = []
    with open(output_path) as f:
        content = f.read()
    for key in ['sessionid', 'sid_ucp_v1', 'odin_tt']:
        lines = [l for l in content.splitlines() if f'\t{key}\t' in l]
        if lines:
            val = lines[0].split('\t')[-1]
            if not val:
                missing.append(key)
        else:
            missing.append(key)

    if missing:
        print(f"\nWARNING: These important cookies are missing or empty: {missing}", file=sys.stderr)
        print("You may need to log in to TikTok in Arc browser first.", file=sys.stderr)
    else:
        print("\nAll critical cookies extracted successfully.", file=sys.stderr)


if __name__ == '__main__':
    output = sys.argv[1] if len(sys.argv) > 1 else 'tiktok-cookies.txt'
    extract_tiktok_cookies(output)
    print(json.dumps({"status": "ok", "output": output}))
