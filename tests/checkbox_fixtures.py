"""Synthetic, non-legal PAO-style scans. Never use a client's document here."""
from PIL import Image, ImageDraw, ImageFont


def checkbox_sheet(oo='checked', hindi='unchecked'):
    image = Image.new('RGB', (1800, 1500), 'white')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('arial.ttf', 31)
    for y, text in [(30, 'SYNTHETIC TEST ONLY - NOT A LEGAL DOCUMENT'),
                    (150, 'II. IMPORMASYON UKOL SA APLIKANTE'),
                    (250, 'Pangalan: SYNTHETIC Ana Reyes'), (350, 'Tirahan: SYNTHETIC Alpha Street'),
                    (550, 'Nakakulong:'), (650, 'Petsa ng pagakakulong:'),
                    (850, 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE'),
                    (950, 'Pangalan: SYNTHETIC Ben Reyes'), (1050, 'Tirahan: SYNTHETIC Beta Street'),
                    (1250, 'III. URI NG KASO'), (1350, 'Criminal: outside retained sections')]:
        draw.text((55, y), text, fill='black', font=font)
    for y, text in [(250, 'Edad: 29 Sex: F Civil Status: Single'), (350, 'Contact No.: 09170001234'),
                    (550, 'Contact No. ng asawa:'), (650, 'Lugar ng Detention:'),
                    (950, 'Edad: 31 Sex: M Civil Status: Single'), (1050, 'Contact No.: 09170005678')]:
        draw.text((920, y), text, fill='black', font=font)
    boxes = {'oo': [340, 552, 365, 585], 'hindi': [500, 552, 525, 585]}
    draw.text((280, 550), 'Oo', fill='black', font=font)
    draw.text((405, 550), 'Hindi', fill='black', font=font)
    for option, state in [('oo', oo), ('hindi', hindi)]:
        x1, y1, x2, y2 = boxes[option]
        draw.rectangle((x1, y1, x2, y2), outline='black', width=2)
        if state == 'checked':
            draw.line((x1+5, y1+5, x2-5, y2-5), fill='black', width=3)
            draw.line((x2-5, y1+5, x1+5, y2-5), fill='black', width=3)
        elif state == 'unknown':
            draw.line((x1+5, y1+5, x2-5, y2-5), fill=(170, 170, 170), width=2)
        elif state == 'cropped':
            draw.rectangle((x1-3, y1-3, x2+3, y2+3), fill='white')
    return image, boxes
