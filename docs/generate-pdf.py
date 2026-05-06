#!/usr/bin/env python3
"""Generate branded PDF for MyAI for One IT Review document."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, cm
from reportlab.lib.colors import HexColor, white, Color
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Image
)
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing, Line, Circle, Rect
from reportlab.graphics import renderPDF
import re
import os

# Brand colors
CYAN = HexColor('#22d3ee')
DARK_BG = HexColor('#060a13')
DARK_SECTION = HexColor('#0c1220')
LIGHT_GRAY = HexColor('#e2e8f0')
MID_GRAY = HexColor('#94a3b8')
WHITE = white
TABLE_HEADER_BG = HexColor('#1e293b')
TABLE_ROW_ALT = HexColor('#f8fafc')
TABLE_BORDER = HexColor('#cbd5e1')

WIDTH, HEIGHT = letter

def draw_logo(c, x, y, size=60):
    """Draw the MyAIforOne logomark (A shape with nodes)."""
    s = size / 512.0
    cx = x
    cy = y

    # Scale coordinates from SVG viewbox
    # Apex at (256, 128), left leg to (160, 364), right to (352, 364)
    # Crossbar from (202, 290) to (310, 290)

    c.setStrokeColor(CYAN)
    c.setFillColor(CYAN)

    # Left leg
    c.setLineWidth(3 * (size/60))
    c.setLineCap(1)  # round
    c.line(cx + (256-256)*s, cy - (128-128)*s, cx + (160-256)*s, cy - (364-128)*s)
    # Right leg
    c.line(cx + (256-256)*s, cy - (128-128)*s, cx + (352-256)*s, cy - (364-128)*s)
    # Crossbar
    c.setLineWidth(2.5 * (size/60))
    c.line(cx + (202-256)*s, cy - (290-128)*s, cx + (310-256)*s, cy - (290-128)*s)

    # Apex node
    c.circle(cx + (256-256)*s, cy - (128-128)*s, 3.5*(size/60), fill=1, stroke=0)
    # Crossbar end nodes (smaller, semi-transparent simulated)
    c.setFillColor(HexColor('#22d3ee'))
    c.circle(cx + (202-256)*s, cy - (290-128)*s, 1.5*(size/60), fill=1, stroke=0)
    c.circle(cx + (310-256)*s, cy - (290-128)*s, 1.5*(size/60), fill=1, stroke=0)


def cover_page(canvas_obj, doc):
    """Draw the branded cover page."""
    canvas_obj.saveState()

    # Full dark background
    canvas_obj.setFillColor(DARK_BG)
    canvas_obj.rect(0, 0, WIDTH, HEIGHT, fill=1, stroke=0)

    # Logo centered
    draw_logo(canvas_obj, WIDTH/2, HEIGHT - 2.5*inch, size=120)

    # Title
    canvas_obj.setFillColor(WHITE)
    canvas_obj.setFont("Helvetica-Bold", 32)
    canvas_obj.drawCentredString(WIDTH/2, HEIGHT - 4.5*inch, "MyAI for One")

    canvas_obj.setFillColor(CYAN)
    canvas_obj.setFont("Helvetica", 18)
    canvas_obj.drawCentredString(WIDTH/2, HEIGHT - 5*inch, "Platform Overview & IT Review")

    # Divider line
    canvas_obj.setStrokeColor(CYAN)
    canvas_obj.setLineWidth(1)
    canvas_obj.line(2*inch, HEIGHT - 5.5*inch, WIDTH - 2*inch, HEIGHT - 5.5*inch)

    # Subtitle info
    canvas_obj.setFillColor(MID_GRAY)
    canvas_obj.setFont("Helvetica", 12)
    canvas_obj.drawCentredString(WIDTH/2, HEIGHT - 6*inch, "Version 1.0  |  April 2026")
    canvas_obj.drawCentredString(WIDTH/2, HEIGHT - 6.3*inch, "Classification: Client-Facing — IT Review")

    # Footer
    canvas_obj.setFillColor(MID_GRAY)
    canvas_obj.setFont("Helvetica", 9)
    canvas_obj.drawCentredString(WIDTH/2, 1*inch, "Confidential — Prepared for IT Review")

    canvas_obj.restoreState()


def header_footer(canvas_obj, doc):
    """Draw header/footer on content pages."""
    canvas_obj.saveState()

    # Header line
    canvas_obj.setStrokeColor(CYAN)
    canvas_obj.setLineWidth(0.5)
    canvas_obj.line(0.75*inch, HEIGHT - 0.6*inch, WIDTH - 0.75*inch, HEIGHT - 0.6*inch)

    # Header text
    canvas_obj.setFillColor(MID_GRAY)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(0.75*inch, HEIGHT - 0.5*inch, "MyAI for One — Platform Overview & IT Review")
    canvas_obj.drawRightString(WIDTH - 0.75*inch, HEIGHT - 0.5*inch, "Confidential")

    # Footer
    canvas_obj.setStrokeColor(TABLE_BORDER)
    canvas_obj.setLineWidth(0.3)
    canvas_obj.line(0.75*inch, 0.6*inch, WIDTH - 0.75*inch, 0.6*inch)
    canvas_obj.setFillColor(MID_GRAY)
    canvas_obj.setFont("Helvetica", 8)
    canvas_obj.drawString(0.75*inch, 0.4*inch, "April 2026")
    canvas_obj.drawRightString(WIDTH - 0.75*inch, 0.4*inch, f"Page {doc.page}")

    canvas_obj.restoreState()


def parse_markdown(md_path):
    """Parse the markdown into structured sections."""
    with open(md_path, 'r') as f:
        content = f.read()

    # Remove frontmatter
    lines = content.split('\n')
    sections = []
    current_section = None
    current_content = []

    for line in lines:
        if line.startswith('# ') and not line.startswith('# MyAI for One'):
            if current_section:
                sections.append((current_section, '\n'.join(current_content)))
            current_section = line[2:].strip()
            current_content = []
        elif line.startswith('## '):
            current_content.append(('h2', line[3:].strip()))
        elif line.startswith('### '):
            current_content.append(('h3', line[4:].strip()))
        elif line.startswith('| ') and '---' not in line:
            current_content.append(('table_row', line))
        elif line.startswith('```'):
            current_content.append(('code_fence', line))
        elif line.strip().startswith('- ') or line.strip().startswith('* '):
            current_content.append(('bullet', line.strip()[2:]))
        elif line.strip().startswith('**Q:'):
            current_content.append(('faq_q', line.strip()))
        elif line.strip().startswith('A:'):
            current_content.append(('faq_a', line.strip()))
        elif line.strip():
            current_content.append(('text', line.strip()))
        else:
            current_content.append(('blank', ''))

    if current_section:
        sections.append((current_section, current_content))

    return sections


def build_pdf():
    md_path = '/Users/oreph/Desktop/APPs/channelToAgentToClaude/docs/MyAIforOne-Platform-Overview-IT-Review.md'
    pdf_path = '/Users/oreph/Desktop/APPs/channelToAgentToClaude/docs/MyAIforOne-Platform-Overview-IT-Review.pdf'

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        topMargin=0.9*inch,
        bottomMargin=0.8*inch,
        leftMargin=0.75*inch,
        rightMargin=0.75*inch,
    )

    # Styles
    styles = getSampleStyleSheet()

    style_h1 = ParagraphStyle(
        'CustomH1', parent=styles['Heading1'],
        fontSize=20, textColor=CYAN, spaceAfter=12, spaceBefore=24,
        fontName='Helvetica-Bold'
    )
    style_h2 = ParagraphStyle(
        'CustomH2', parent=styles['Heading2'],
        fontSize=14, textColor=HexColor('#1e40af'), spaceAfter=8, spaceBefore=16,
        fontName='Helvetica-Bold'
    )
    style_h3 = ParagraphStyle(
        'CustomH3', parent=styles['Heading3'],
        fontSize=11, textColor=HexColor('#334155'), spaceAfter=6, spaceBefore=12,
        fontName='Helvetica-Bold'
    )
    style_body = ParagraphStyle(
        'CustomBody', parent=styles['Normal'],
        fontSize=10, textColor=HexColor('#1e293b'), spaceAfter=6,
        fontName='Helvetica', leading=14, alignment=TA_JUSTIFY
    )
    style_bullet = ParagraphStyle(
        'CustomBullet', parent=style_body,
        leftIndent=20, bulletIndent=10, spaceAfter=4,
    )
    style_faq_q = ParagraphStyle(
        'FaqQ', parent=style_body,
        fontName='Helvetica-Bold', spaceBefore=10, spaceAfter=2,
    )
    style_faq_a = ParagraphStyle(
        'FaqA', parent=style_body,
        leftIndent=10, spaceAfter=8,
    )
    style_code = ParagraphStyle(
        'Code', parent=style_body,
        fontName='Courier', fontSize=8, leftIndent=20,
        backColor=HexColor('#f1f5f9'), spaceAfter=4, leading=11,
    )

    # Parse markdown
    with open(md_path, 'r') as f:
        content = f.read()

    story = []

    # Cover page placeholder (handled by onFirstPage) — use a small spacer then page break
    story.append(PageBreak())

    # Process content
    lines = content.split('\n')
    i = 0
    in_code_block = False
    table_rows = []
    table_header = None

    # Skip title and metadata
    while i < len(lines) and not lines[i].startswith('## 1.'):
        if lines[i].startswith('## ') or lines[i].startswith('# ') and 'Executive' in lines[i]:
            break
        i += 1

    # Find sections by ## numbering
    while i < len(lines):
        line = lines[i]

        # Code blocks
        if line.strip().startswith('```'):
            in_code_block = not in_code_block
            i += 1
            continue

        if in_code_block:
            # Render code line
            escaped = line.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            story.append(Paragraph(escaped, style_code))
            i += 1
            continue

        # Flush table if we have rows and hit non-table
        if table_rows and not line.startswith('|'):
            # Build table
            story.append(Spacer(1, 6))
            t = Table(table_rows, repeatRows=1)
            t_style = [
                ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('GRID', (0, 0), (-1, -1), 0.5, TABLE_BORDER),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ]
            # Alternate row colors
            for row_idx in range(1, len(table_rows)):
                if row_idx % 2 == 0:
                    t_style.append(('BACKGROUND', (0, row_idx), (-1, row_idx), TABLE_ROW_ALT))
            t.setStyle(TableStyle(t_style))
            story.append(t)
            story.append(Spacer(1, 8))
            table_rows = []

        # Section headers
        if line.startswith('## '):
            # Page break before major numbered sections
            title = line[3:].strip()
            if re.match(r'^\d+\.', title) and not title.startswith('1.'):
                story.append(PageBreak())
            story.append(Paragraph(title, style_h1))
        elif line.startswith('### '):
            title = line[4:].strip()
            story.append(Paragraph(title, style_h2))
        elif line.startswith('#### '):
            title = line[5:].strip()
            story.append(Paragraph(title, style_h3))
        elif line.startswith('# ') and i > 5:
            title = line[2:].strip()
            story.append(PageBreak())
            story.append(Paragraph(title, style_h1))

        # Tables
        elif line.startswith('|'):
            if '---' in line:
                i += 1
                continue
            cells = [c.strip() for c in line.split('|')[1:-1]]
            # Clean markdown bold
            cells = [re.sub(r'\*\*(.*?)\*\*', r'\1', c) for c in cells]
            if not table_rows:
                table_rows.append(cells)
            else:
                table_rows.append(cells)

        # Bullets
        elif line.strip().startswith('- ') or line.strip().startswith('* '):
            text = line.strip()[2:]
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            story.append(Paragraph(f"• {text}", style_bullet))

        # Horizontal rule / divider
        elif line.strip() == '---':
            story.append(Spacer(1, 12))

        # Regular text
        elif line.strip():
            text = line.strip()
            # Bold
            text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
            # Handle Q&A style
            if text.startswith('**Q:') or text.startswith('<b>Q:'):
                story.append(Paragraph(text, style_faq_q))
            elif text.startswith('A:'):
                story.append(Paragraph(text, style_faq_a))
            else:
                story.append(Paragraph(text, style_body))
        else:
            story.append(Spacer(1, 4))

        i += 1

    # Flush final table
    if table_rows:
        story.append(Spacer(1, 6))
        t = Table(table_rows, repeatRows=1)
        t_style = [
            ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_BG),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('GRID', (0, 0), (-1, -1), 0.5, TABLE_BORDER),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]
        for row_idx in range(1, len(table_rows)):
            if row_idx % 2 == 0:
                t_style.append(('BACKGROUND', (0, row_idx), (-1, row_idx), TABLE_ROW_ALT))
        t.setStyle(TableStyle(t_style))
        story.append(t)

    # Build
    doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
    print(f"PDF generated: {pdf_path}")
    print(f"Size: {os.path.getsize(pdf_path) / 1024:.0f} KB")


if __name__ == '__main__':
    build_pdf()
