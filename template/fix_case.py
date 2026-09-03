#!/usr/bin/env python3
"""
RPG Maker MV Case Sensitivity Helper
Fixes/links files in the www directory to avoid crashes on Linux due to case differences in scripts/plugins.
"""

import os
import sys

def normalize_www(www_path):
    if not os.path.exists(www_path):
        print(f"[fix_case] www directory not found at: {www_path}")
        return

    print(f"[fix_case] Scanning {www_path} for potential case-sensitivity issues...")
    
    file_map = {}
    created_links = 0

    for root, dirs, files in os.walk(www_path):
        for name in files:
            full_path = os.path.join(root, name)
            lower_name = name.lower()
            lower_path = os.path.join(root, lower_name)
            
            # If the filename has uppercase letters and lowercase version does not exist
            if name != lower_name and not os.path.exists(lower_path):
                try:
                    os.symlink(name, lower_path)
                    created_links += 1
                except Exception as e:
                    # In case filesystem doesn't support symlinks (e.g. exFAT/FAT32)
                    pass

    print(f"[fix_case] Completed scan. Normalized {created_links} files with lowercase symlinks.")

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "./www"
    normalize_www(target)
