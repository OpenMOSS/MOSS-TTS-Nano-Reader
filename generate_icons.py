"""
Generate PNG icons for the Chrome extension.
Run with: uv run generate_icons.py
"""

from PIL import Image, ImageDraw

def create_icon(size: int) -> Image.Image:
    """Create a simple icon with a play button."""
    # Create image with rounded corners effect
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Background color (indigo)
    bg_color = (99, 102, 241, 255)
    
    # Draw rounded rectangle background
    radius = size // 5
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=bg_color
    )
    
    # Draw play triangle (white)
    margin = size // 4
    play_points = [
        (margin + size // 8, margin),  # top left
        (margin + size // 8, size - margin),  # bottom left
        (size - margin, size // 2),  # right point
    ]
    draw.polygon(play_points, fill=(255, 255, 255, 255))
    
    return img


def main():
    sizes = [16, 32, 48, 128]
    
    for size in sizes:
        icon = create_icon(size)
        filename = f"extension/icons/icon{size}.png"
        icon.save(filename, 'PNG')
        print(f"Created {filename}")
    
    print("Icons generated successfully!")


if __name__ == '__main__':
    main()
