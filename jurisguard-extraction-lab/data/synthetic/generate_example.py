"""Generate a clearly synthetic image fixture; never use real case data here."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
LINES = (
    "INTERVIEW SHEET",
    "Name: Ana Reyes",
    "Contact No.: 09170001234",
    "Address: 12 Mabini Street",
)


def main() -> None:
    try:
        font = ImageFont.truetype("arial.ttf", 42)
    except OSError:
        font = ImageFont.truetype("DejaVuSans.ttf", 42)
    image = Image.new("RGB", (1600, 520), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(LINES):
        draw.text((55, 55 + index * 105), line, fill="black", font=font)
    image.save(ROOT / "synthetic_intake.png")


if __name__ == "__main__":
    main()
