"""Convert report HTML to editable Word paragraphs and tables without fetching resources."""
from io import BytesIO
import re
from bs4 import BeautifulSoup, NavigableString
from docx import Document
from docx.shared import Inches, Pt, RGBColor


def render_word(body_html):
    soup = BeautifulSoup(body_html, "html.parser")
    for node in soup.select("script, style, head, button, nav, svg"):
        node.decompose()
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Inches(8.27), Inches(11.69)
    section.top_margin = section.bottom_margin = Inches(.7)
    section.left_margin = section.right_margin = Inches(.7)
    normal = document.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    for level in range(1, 5):
        document.styles[f"Heading {level}"].font.color.rgb = RGBColor(0, 0, 0)

    def inline(node, paragraph, bold=False, italic=False):
        if isinstance(node, NavigableString):
            text = re.sub(r"\s+", " ", str(node))
            run = paragraph.add_run(text)
            run.bold, run.italic = bold, italic
            return
        if node.name == "br":
            paragraph.add_run().add_break()
            return
        for child in node.children:
            inline(child, paragraph, bold or node.name in ("b", "strong", "th"), italic or node.name in ("i", "em"))

    blocks = {"p", "div", "section", "article", "main", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "pre", "blockquote"}
    def walk(node, target):
        pending = []
        def flush():
            if any(str(x).strip() for x in pending):
                paragraph = target.add_paragraph()
                for child in pending:
                    inline(child, paragraph)
            pending.clear()
        for child in node.children:
            if isinstance(child, NavigableString) or child.name not in blocks:
                pending.append(child)
                continue
            flush()
            name = child.name
            if name == "table":
                rows = [r for r in child.find_all("tr") if r.find_parent("table") is child]
                width = max((sum(int(c.get("colspan", 1)) for c in r.find_all(["td", "th"], recursive=False)) for r in rows), default=0)
                if not width:
                    continue
                table = target.add_table(rows=0, cols=min(width, 30))
                table.style = "Table Grid"
                for row in rows:
                    cells = table.add_row().cells
                    column = 0
                    for source in row.find_all(["td", "th"], recursive=False):
                        if column >= len(cells): break
                        span = min(max(1, int(source.get("colspan", 1))), len(cells)-column)
                        cell = cells[column]
                        if span > 1: cell = cell.merge(cells[column+span-1])
                        inline(source, cell.paragraphs[0], source.name == "th")
                        column += span
            elif name.startswith("h") and name[1:].isdigit():
                paragraph = target.add_paragraph(style=f"Heading {min(int(name[1:]), 4)}")
                inline(child, paragraph)
            elif name == "pre":
                for line in child.get_text().splitlines():
                    target.add_paragraph(line)
            elif name == "li":
                paragraph = target.add_paragraph(style="List Number" if child.parent.name == "ol" else "List Bullet")
                inline(child, paragraph)
            elif name in ("p", "blockquote"):
                paragraph = target.add_paragraph()
                inline(child, paragraph)
            else:
                walk(child, target)
        flush()
    walk(soup, document)
    output = BytesIO()
    document.save(output)
    return output.getvalue()
