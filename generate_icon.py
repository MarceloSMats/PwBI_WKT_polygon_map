import os
from PIL import Image, ImageDraw, ImageFont

def create_wkt_icon(output_path="assets/icon.png", target_size=(64, 64)):
    scale = 4
    canvas_w = target_size[0] * scale
    canvas_h = target_size[1] * scale
    
    img = Image.new("RGBA", (canvas_w, canvas_h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    # 1. Polígono estilizado bem preenchido no canvas
    poly_points = [
        (28, 76),
        (108, 22),
        (228, 48),
        (236, 172),
        (144, 234),
        (24, 192)
    ]

    # Preenchimento em azul vibrante do Power BI / Tailwind 500
    draw.polygon(poly_points, fill=(59, 130, 246, 215))

    # Borda sólida em azul royal escuro (#1d4ed8)
    draw.polygon(poly_points, outline=(29, 78, 216, 255), width=10)

    # Vértices nos cantos do polígono
    for px, py in poly_points:
        r = 10
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, 255), outline=(29, 78, 216, 255), width=4)

    # 2. Letras "WKT" SOBREPOSTAS ao polígono, levemente alinhadas à direita
    font_path = "C:/Windows/Fonts/segoeuib.ttf"
    if not os.path.exists(font_path):
        font_path = "C:/Windows/Fonts/arialbd.ttf"

    font_size = 56
    font = ImageFont.truetype(font_path, font_size)

    text = "WKT"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # Posição: sobrepondo a face do polígono, levemente alinhado à direita
    # tx escolhido para que termine em torno de x=224, bem dentro do polígono
    tx = 108
    ty = (canvas_h - text_h) // 2 - bbox[1] + 12

    # Contorno/sombra suave escuro para máximo destaque e contraste
    shadow_color = (15, 23, 42, 240)
    for dx in [-3, -2, -1, 0, 1, 2, 3]:
        for dy in [-3, -2, -1, 0, 1, 2, 3]:
            if 0 < dx * dx + dy * dy <= 9:
                draw.text((tx + dx, ty + dy), text, font=font, fill=shadow_color)

    # Texto em Branco Puro (#ffffff)
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # Redimensionar com interpolação Lanczos para nitidez cristalina
    final_img = img.resize(target_size, Image.Resampling.LANCZOS)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    final_img.save(output_path, "PNG")
    print(f"Icon successfully generated at {output_path} with size {target_size}")

if __name__ == "__main__":
    create_wkt_icon()
