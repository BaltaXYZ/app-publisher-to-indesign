#!/usr/bin/env python3

import hashlib
import json
import os
import sys

import fitz


def color_to_hex(color_value):
    return "#{:06x}".format(int(color_value) & 0xFFFFFF)


def sanitize_text(text):
    return text.replace("\u0000", "").replace("\r", "")


def ensure_character_style(span, style_map, styles):
    font_name = str(span.get("font", "UnknownFont"))
    font_size = round(float(span.get("size", 0.0)), 3)
    color_hex = color_to_hex(span.get("color", 0))
    flags = int(span.get("flags", 0))
    key = (font_name, font_size, color_hex, flags)

    style_id = style_map.get(key)
    if style_id:
        return style_id

    style_id = "char-{}".format(len(style_map) + 1)
    style_map[key] = style_id
    styles.append(
        {
            "id": style_id,
            "fontFamily": font_name,
            "fontSizePt": font_size,
            "color": {"hex": color_hex},
        }
    )
    return style_id


def save_image_block(page_number, block_number, block, assets_dir):
    image_bytes = block.get("image")
    if not image_bytes:
        return None

    mask_bytes = block.get("mask")
    ext = str(block.get("ext", "png")).lower()
    digest = hashlib.sha1(image_bytes).hexdigest()[:12]

    if mask_bytes:
        ext = "png"

    file_name = "page-{:02d}-block-{:03d}-{}.{}".format(page_number, block_number, digest, ext)
    file_path = os.path.join(assets_dir, file_name)

    if mask_bytes:
        base_pixmap = fitz.Pixmap(image_bytes)
        mask_pixmap = fitz.Pixmap(mask_bytes)
        composed_pixmap = fitz.Pixmap(base_pixmap, mask_pixmap)
        composed_pixmap.save(file_path)
    else:
        with open(file_path, "wb") as handle:
            handle.write(image_bytes)

    return {
        "name": file_name,
        "path": file_path,
    }


def line_to_item(line, style_map, styles):
    runs = []
    max_font_size = 0.0

    for span in line.get("spans", []):
        text = sanitize_text(span.get("text", ""))
        if not text:
            continue

        max_font_size = max(max_font_size, float(span.get("size", 0.0)))
        runs.append(
            {
                "text": text,
                "characterStyleId": ensure_character_style(span, style_map, styles),
                "fontFamily": str(span.get("font", "UnknownFont")),
                "fontSizePt": round(float(span.get("size", 0.0)), 3),
                "color": {"hex": color_to_hex(span.get("color", 0))},
            }
        )

    if not runs:
        return None

    x0, y0, x1, y1 = line["bbox"]
    width_padding = max(2.0, max_font_size * 0.2)
    height_padding = max(2.0, max_font_size * 0.3)
    return {
        "kind": "textFrame",
        "xPt": x0,
        "yPt": y0,
        "widthPt": max(0.0, x1 - x0) + width_padding,
        "heightPt": max(0.0, y1 - y0) + height_padding,
        "paragraphs": [{"runs": runs}],
    }


def build_document(pdf_path, assets_dir):
    document = fitz.open(pdf_path)
    if document.page_count == 0:
        raise RuntimeError("PDF contains no pages")

    first_page = document[0]
    page_width = float(first_page.rect.width)
    page_height = float(first_page.rect.height)
    character_styles = []
    character_style_map = {}
    image_fills = []
    pages = []

    for page_index, page in enumerate(document):
        page_dict = page.get_text("dict")
        shape_items = []
        text_items = []

        for block in page_dict.get("blocks", []):
            block_number = int(block.get("number", 0))

            if block.get("type") == 1:
                image_fill = save_image_block(page_index + 1, block_number, block, assets_dir)
                if not image_fill:
                    continue

                image_fills.append(image_fill)
                x0, y0, x1, y1 = block["bbox"]
                shape_items.append(
                    {
                        "kind": "shape",
                        "shapeType": "frame",
                        "xPt": x0,
                        "yPt": y0,
                        "widthPt": max(0.0, x1 - x0),
                        "heightPt": max(0.0, y1 - y0),
                        "fillImage": image_fill,
                    }
                )
                continue

            if block.get("type") != 0:
                continue

            for line in block.get("lines", []):
                item = line_to_item(line, character_style_map, character_styles)
                if item:
                    text_items.append(item)

        pages.append(
            {
                "id": "page-{}".format(page_index + 1),
                "name": "Page {}".format(page_index + 1),
                "widthPt": float(page.rect.width),
                "heightPt": float(page.rect.height),
                "items": shape_items + text_items,
            }
        )

    return {
        "sourcePath": pdf_path,
        "pageWidthPt": page_width,
        "pageHeightPt": page_height,
        "pages": pages,
        "paragraphStyles": [],
        "characterStyles": character_styles,
        "graphicStyles": [],
        "imageFills": image_fills,
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: extract-pdf-layout.py <input-pdf> <output-json> <assets-dir>")

    pdf_path = os.path.abspath(sys.argv[1])
    output_path = os.path.abspath(sys.argv[2])
    assets_dir = os.path.abspath(sys.argv[3])
    os.makedirs(assets_dir, exist_ok=True)

    document = build_document(pdf_path, assets_dir)

    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
