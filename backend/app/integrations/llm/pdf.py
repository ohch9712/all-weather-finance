from io import BytesIO

import pypdfium2 as pdfium


def pdf_to_png_pages(data: bytes) -> list[bytes]:
    if not data.lstrip().startswith(b"%PDF-"):
        raise ValueError("올바른 PDF 파일이 아닙니다.")
    pages = []
    try:
        with pdfium.PdfDocument(data) as document:
            for index in range(len(document)):
                with document[index] as page:
                    with page.render(scale=2) as bitmap:
                        with bitmap.to_pil() as image:
                            buffer = BytesIO()
                            image.save(buffer, format="PNG")
                            pages.append(buffer.getvalue())
    except pdfium.PdfiumError as exc:
        raise ValueError("올바른 PDF 파일이 아닙니다.") from exc
    return pages
