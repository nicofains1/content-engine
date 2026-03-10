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
        except Exception as e:
            return ''
    elif encrypted_value[:3] == b'v10':
        # AES-128-CBC: IV is 16 spaces, ciphertext starts at byte 3
        iv = b' ' * 16
        ciphertext = encrypted_value[3:]
        try:
            cipher = AES.new(key_v10, AES.MODE_CBC, IV=iv)
            decrypted = cipher.decrypt(ciphertext)
            # Remove PKCS7 padding
            pad_len = decrypted[-1]
            if pad_len <= 16:
                decrypted = decrypted[:-pad_len]
            return decrypted.decode('utf-8', errors='replace')
        except Exception as e:
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
