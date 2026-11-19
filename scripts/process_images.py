import os
import sys
from PIL import Image

def optimize_image(src_path, dest_path, target_size=(800, 600), quality=82):
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    img = Image.open(src_path)
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')
    
    # Maintain or crop to 4:3
    img = img.resize(target_size, Image.Resampling.LANCZOS)
    img.save(dest_path, 'WEBP', quality=quality)
    size_kb = os.path.getsize(dest_path) / 1024
    print(f"[OK] {os.path.basename(dest_path)} ({size_kb:.1f} KB)")
    return dest_path

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 process_images.py <src> <dest>")
        sys.exit(1)
    optimize_image(sys.argv[1], sys.argv[2])
