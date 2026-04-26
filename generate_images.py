#!/usr/bin/env python3
"""Generate 10 packages of 20 images each for the Alpaca Crypto Trader project."""
import os
import math
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = "/home/elias/.paperclip/instances/default/projects/a3a70364-1109-4bd8-9d8b-a49c7f8407f2/e3d52aee-ef49-41bf-969b-160b095beca8/getting-started/images"
W, H = 512, 512

themes = [
    ("crypto_charts", "Cryptocurrency chart patterns"),
    ("trading_floors", "Abstract trading floor visualizations"),
    ("market_sentiment", "Market sentiment gauges and meters"),
    ("blockchain_art", "Blockchain-inspired abstract art"),
    ("portfolio_viz", "Portfolio visualization concepts"),
    ("candlestick_art", "Artistic candlestick pattern designs"),
    ("network_nodes", "Crypto network node visualizations"),
    ("price_waves", "Price wave and oscillation patterns"),
    ("risk_heatmaps", "Risk analysis heatmap visualizations"),
    ("crypto_logos", "Stylized crypto-inspired logo art"),
]

COLORS = [
    (0, 255, 136),   # crypto green
    (255, 51, 102),  # crypto red/pink
    (0, 153, 255),   # blue
    (255, 170, 0),   # orange
    (153, 51, 255),  # purple
    (0, 204, 204),   # cyan
    (255, 204, 0),   # gold
    (51, 255, 204),  # mint
    (255, 102, 0),   # deep orange
    (102, 0, 255),   # indigo
]

BG_COLORS = [
    (15, 15, 25),
    (10, 10, 20),
    (20, 15, 10),
    (5, 10, 20),
    (15, 20, 15),
    (25, 10, 15),
    (10, 20, 25),
    (20, 5, 20),
    (15, 15, 30),
    (25, 20, 10),
]

def draw_grid(draw, w, h, color, spacing=40):
    for x in range(0, w, spacing):
        draw.line([(x, 0), (x, h)], fill=(*color, 30), width=1)
    for y in range(0, h, spacing):
        draw.line([(0, y), (w, y)], fill=(*color, 30), width=1)

def draw_candlestick_chart(draw, w, h, accent, i):
    random.seed(i * 100)
    candles = 24
    spacing = w // (candles + 1)
    base_y = h // 2
    for c in range(candles):
        x = spacing * (c + 1)
        body_h = random.randint(20, 80)
        wick_h = random.randint(10, 40)
        direction = random.choice([-1, 1])
        color = COLORS[c % len(COLORS)] if random.random() > 0.5 else accent
        y_center = base_y + random.randint(-50, 50)
        draw.line([(x, y_center - body_h - wick_h), (x, y_center + body_h + wick_h)], fill=color, width=1)
        draw.rectangle([x-4, y_center - body_h, x+4, y_center + body_h], fill=color)

def draw_wave_pattern(draw, w, h, accent, i):
    random.seed(i * 200)
    for wave in range(5):
        points = []
        amplitude = random.randint(30, 80)
        frequency = random.uniform(0.01, 0.03)
        phase = random.uniform(0, 2 * math.pi)
        y_offset = h // 2 + (wave - 2) * 40
        color = COLORS[(i + wave) % len(COLORS)]
        for x in range(0, w):
            y = y_offset + int(amplitude * math.sin(frequency * x + phase))
            points.append((x, y))
        if len(points) > 2:
            draw.line(points, fill=color, width=2)

def draw_circular_nodes(draw, w, h, accent, i):
    random.seed(i * 300)
    nodes = []
    for _ in range(8):
        x, y = random.randint(50, w-50), random.randint(50, h-50)
        r = random.randint(15, 35)
        nodes.append((x, y, r))
    for idx, (x1, y1, r1) in enumerate(nodes):
        for jdx, (x2, y2, r2) in enumerate(nodes):
            if idx < jdx and random.random() > 0.4:
                draw.line([(x1, y1), (x2, y2)], fill=(*accent, 100), width=1)
    for x, y, r in nodes:
        color = COLORS[random.randint(0, len(COLORS)-1)]
        draw.ellipse([x-r, y-r, x+r, y+r], fill=color, outline=(255,255,255))

def draw_heatmap(draw, w, h, accent, i):
    random.seed(i * 400)
    cell_w, cell_h = 16, 16
    for gy in range(0, h, cell_h):
        for gx in range(0, w, cell_w):
            val = random.random()
            r = int(val * 255)
            g = int((1 - val) * 100)
            b = int((1 - abs(val - 0.5) * 2) * 200)
            draw.rectangle([gx, gy, gx + cell_w - 1, gy + cell_h - 1], fill=(r, g, b))

def draw_gauge(draw, w, h, accent, i):
    random.seed(i * 500)
    cx, cy = w // 2, h // 2
    radius = 150
    draw.arc([cx-radius, cy-radius, cx+radius, cy+radius], 180, 360, fill=accent, width=6)
    angle = random.uniform(190, 350)
    rad = math.radians(angle)
    ex, ey = cx + int(radius * math.cos(rad)), cy + int(radius * math.sin(rad))
    draw.line([(cx, cy), (ex, ey)], fill=(255, 255, 255), width=3)
    for a in range(180, 361, 10):
        rad = math.radians(a)
        x1 = cx + int((radius-10) * math.cos(rad))
        y1 = cy + int((radius-10) * math.sin(rad))
        x2 = cx + int((radius+5) * math.cos(rad))
        y2 = cy + int((radius+5) * math.sin(rad))
        draw.line([(x1, y1), (x2, y2)], fill=(200, 200, 200), width=1)

def draw_portfolio_pie(draw, w, h, accent, i):
    random.seed(i * 600)
    cx, cy = w // 2, h // 2
    radius = 180
    segments = random.randint(4, 8)
    start = 0
    for s in range(segments):
        extent = random.uniform(30, 120)
        color = COLORS[s % len(COLORS)]
        draw.pieslice([cx-radius, cy-radius, cx+radius, cy+radius], start, start + extent, fill=color, outline=(0,0,0))
        start += extent

def draw_blockchain(draw, w, h, accent, i):
    random.seed(i * 700)
    block_w, block_h = 60, 40
    chain_len = random.randint(5, 8)
    start_x = (w - chain_len * (block_w + 30)) // 2
    for b in range(chain_len):
        x = start_x + b * (block_w + 30)
        y = h // 2 + random.randint(-60, 60)
        color = COLORS[b % len(COLORS)]
        draw.rounded_rectangle([x, y, x+block_w, y+block_h], radius=8, fill=color, outline=(255,255,255))
        draw.text((x+10, y+12), f"B{b}", fill=(255,255,255))
        if b < chain_len - 1:
            nx = x + block_w + 30
            ny = h // 2 + random.randint(-60, 60)
            draw.line([(x+block_w, y+block_h//2), (nx, ny+block_h//2)], fill=(255,255,255), width=2)

def draw_logo(draw, w, h, accent, i):
    random.seed(i * 800)
    cx, cy = w // 2, h // 2
    shapes = random.randint(3, 6)
    for s in range(shapes):
        color = COLORS[s % len(COLORS)]
        r = random.randint(40, 120)
        angle = s * (360 // shapes)
        rad = math.radians(angle)
        x = cx + int(r * 0.3 * math.cos(rad))
        y = cy + int(r * 0.3 * math.sin(rad))
        shape_type = random.choice(['circle', 'diamond', 'hex'])
        if shape_type == 'circle':
            draw.ellipse([x-r//2, y-r//2, x+r//2, y+r//2], fill=color, outline=(255,255,255))
        elif shape_type == 'diamond':
            draw.polygon([(x, y-r//2), (x+r//2, y), (x, y+r//2), (x-r//2, y)], fill=color, outline=(255,255,255))
        else:
            points = [(x + int(r//2*math.cos(math.radians(a+60))), y + int(r//2*math.sin(math.radians(a+60)))) for a in range(0, 360, 60)]
            draw.polygon(points, fill=color, outline=(255,255,255))

def draw_abstract_combo(draw, w, h, accent, i):
    random.seed(i * 900)
    draw_candlestick_chart(draw, w, h, accent, i)
    draw.line([(0, random.randint(h//3, 2*h//3)), (w, random.randint(h//3, 2*h//3))], fill=(*accent, 80), width=2)

draw_funcs = [
    draw_candlestick_chart,
    draw_wave_pattern,
    draw_circular_nodes,
    draw_heatmap,
    draw_gauge,
    draw_portfolio_pie,
    draw_blockchain,
    draw_logo,
    draw_abstract_combo,
    draw_wave_pattern,
]

def generate_all():
    total = 0
    for pkg_idx, (theme_name, theme_desc) in enumerate(themes):
        pkg_dir = os.path.join(BASE, f"package-{pkg_idx+1:02d}-{theme_name}")
        os.makedirs(pkg_dir, exist_ok=True)
        accent = COLORS[pkg_idx]
        bg = BG_COLORS[pkg_idx]
        draw_func = draw_funcs[pkg_idx]
        
        for img_idx in range(20):
            img = Image.new('RGB', (W, H), bg)
            draw = ImageDraw.Draw(img, 'RGBA')
            draw_grid(draw, W, H, accent)
            seed_val = pkg_idx * 100 + img_idx
            draw_func(draw, W, H, accent, seed_val)
            
            # Add theme label
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
            except:
                font = ImageFont.load_default()
            draw.text((10, H - 30), f"{theme_name} #{img_idx+1}", fill=(200, 200, 200), font=font)
            
            filepath = os.path.join(pkg_dir, f"{theme_name}_{img_idx+1:02d}.png")
            img.save(filepath, "PNG")
            total += 1
    
    print(f"Generated {total} images across {len(themes)} packages")

if __name__ == "__main__":
    generate_all()