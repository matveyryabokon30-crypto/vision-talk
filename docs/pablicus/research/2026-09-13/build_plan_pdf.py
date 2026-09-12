"""Render the canonical plan with ReportLab. Does not alter application code."""
from pathlib import Path
import re
from html import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUT = REPO / 'output/pdf/Pablicus_Implementation_Plan.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
fonts = Path('/System/Library/Fonts/Supplemental')
if fonts.exists():
    regular, bold = fonts / 'Arial.ttf', fonts / 'Arial Bold.ttf'
else:
    fonts = Path('/usr/share/fonts/truetype/dejavu')
    regular, bold = fonts / 'DejaVuSans.ttf', fonts / 'DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('Body', str(regular)))
pdfmetrics.registerFont(TTFont('BodyBold', str(bold)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='BodyBold', italic='Body', boldItalic='BodyBold')
styles = {
    'body': ParagraphStyle('body', fontName='Body', fontSize=10, leading=14, spaceAfter=8, splitLongWords=True),
    'title': ParagraphStyle('title', fontName='BodyBold', fontSize=20, leading=25, spaceAfter=17, keepWithNext=True),
    'h2': ParagraphStyle('h2', fontName='BodyBold', fontSize=13, leading=17, spaceBefore=12, spaceAfter=8, keepWithNext=True),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.5, leading=11.5, splitLongWords=True),
    'note': ParagraphStyle('note', fontName='Body', fontSize=8.2, leading=10, spaceAfter=3, splitLongWords=True),
}

def inline(s):
    s = escape(s.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-'))
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', lambda m: '<link href="'+m[2]+'" color="#303030"><u>'+m[1]+'</u></link>', s)
    s = re.sub(r'\[\^(\d+)\]', r'<super>\1</super>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+)`', r'\1', s)
    return s

lines = (ROOT / 'PABLICUS_IMPLEMENTATION_PLAN.md').read_text().splitlines()
story, para = [], []

def flush():
    if para:
        story.append(Paragraph(inline(' '.join(para)), styles['body']))
        para.clear()

i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        flush(); i += 1; continue
    if line.startswith('# '):
        flush(); story.append(Paragraph(inline(line[2:]), styles['title']))
    elif line.startswith('## '):
        flush()
        if line.startswith('## 16.'): story.append(PageBreak())
        story.append(Paragraph(inline(line[3:]), styles['h2']))
    elif line.startswith('|'):
        flush(); rows=[]
        while i < len(lines) and lines[i].startswith('|'):
            cells=[c.strip() for c in lines[i].strip('|').split('|')]
            if not all(re.fullmatch(r'[:\- ]+', c) for c in cells):
                rows.append(cells)
            i += 1
        n=len(rows[0]); widths={2:[108,407],3:[115,177,223],4:[93,160,132,130]}[n]
        data=[[Paragraph(inline(c), styles['cell']) for c in row] for row in rows]
        for j,c in enumerate(rows[0]): data[0][j]=Paragraph('<b>'+inline(c)+'</b>',styles['cell'])
        table=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
        table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eeeeee')),('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor('#aaaaaa')),('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#dddddd')),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story.extend([table,Spacer(1,10)]); continue
    elif re.match(r'^\[\^\d+\]:',line):
        flush(); line=re.sub(r'^\[\^(\d+)\]:',r'\1.',line)
        story.append(Paragraph(inline(line),styles['note']))
    elif re.match(r'^\d+\. ',line):
        flush(); story.append(Paragraph(inline(line),styles['body']))
    else:
        para.append(line)
    i += 1
flush()
doc=SimpleDocTemplate(str(OUT),pagesize=(595.28,841.89),leftMargin=40,rightMargin=40,topMargin=38,bottomMargin=38,title='Пабликус: план развития действующего приложения',author='')
def page_footer(canvas, document):
    canvas.saveState()
    canvas.setFont('Body', 8)
    canvas.setFillColor(colors.HexColor('#666666'))
    canvas.drawRightString(555, 20, str(document.page))
    canvas.restoreState()

doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
print(OUT)
