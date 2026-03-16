#!/usr/bin/env python3
"""Generate Procurement Module User Manual PDF"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Image, KeepTogether, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.pdfgen import canvas
import os

OUTPUT = "/sessions/serene-jolly-carson/mnt/saifraza/Desktop/distillery-erp/MSPIL_Procurement_Manual.pdf"

# Colors
BLUE = HexColor("#1e40af")
DARK_BLUE = HexColor("#1e3a5f")
LIGHT_BLUE = HexColor("#dbeafe")
GREEN = HexColor("#166534")
LIGHT_GREEN = HexColor("#dcfce7")
ORANGE = HexColor("#c2410c")
LIGHT_ORANGE = HexColor("#fff7ed")
GRAY = HexColor("#6b7280")
LIGHT_GRAY = HexColor("#f3f4f6")
RED = HexColor("#dc2626")
PURPLE = HexColor("#7c3aed")

styles = getSampleStyleSheet()

# Custom styles
styles.add(ParagraphStyle(
    name='CoverTitle', parent=styles['Title'],
    fontSize=32, leading=40, textColor=DARK_BLUE,
    spaceAfter=10, alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    name='CoverSubtitle', parent=styles['Normal'],
    fontSize=16, leading=22, textColor=GRAY,
    spaceAfter=30, alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    name='SectionTitle', parent=styles['Heading1'],
    fontSize=22, leading=28, textColor=DARK_BLUE,
    spaceBefore=20, spaceAfter=12, borderWidth=0,
    borderPadding=0
))
styles.add(ParagraphStyle(
    name='SubSection', parent=styles['Heading2'],
    fontSize=14, leading=18, textColor=BLUE,
    spaceBefore=14, spaceAfter=8
))
styles.add(ParagraphStyle(
    name='BodyText2', parent=styles['Normal'],
    fontSize=10.5, leading=15, spaceAfter=8,
    alignment=TA_JUSTIFY
))
styles.add(ParagraphStyle(
    name='StepNum', parent=styles['Normal'],
    fontSize=12, leading=16, textColor=white,
    alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    name='StepText', parent=styles['Normal'],
    fontSize=10.5, leading=15, spaceAfter=4
))
styles.add(ParagraphStyle(
    name='Note', parent=styles['Normal'],
    fontSize=9.5, leading=13, textColor=ORANGE,
    leftIndent=20, spaceBefore=6, spaceAfter=6
))
styles.add(ParagraphStyle(
    name='TOCEntry', parent=styles['Normal'],
    fontSize=12, leading=20, leftIndent=20
))
styles.add(ParagraphStyle(
    name='Footer', parent=styles['Normal'],
    fontSize=8, textColor=GRAY, alignment=TA_CENTER
))

def make_step_table(steps):
    """Create a numbered steps table"""
    data = []
    for i, (title, desc) in enumerate(steps, 1):
        num_para = Paragraph(f'<b>{i}</b>', ParagraphStyle(
            'num', parent=styles['Normal'], fontSize=12,
            textColor=white, alignment=TA_CENTER
        ))
        title_para = Paragraph(f'<b>{title}</b>', styles['StepText'])
        desc_para = Paragraph(desc, ParagraphStyle(
            'stepdesc', parent=styles['Normal'], fontSize=9.5,
            leading=13, textColor=GRAY
        ))
        data.append([num_para, [title_para, desc_para]])

    t = Table(data, colWidths=[35, 430])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), BLUE),
        ('TEXTCOLOR', (0, 0), (0, -1), white),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (1, 0), (1, -1), 12),
        ('RIGHTPADDING', (1, 0), (1, -1), 8),
        ('ROWBACKGROUNDS', (1, 0), (1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -2), 0.3, HexColor("#e5e7eb")),
    ]))
    return t

def make_flow_diagram(stages):
    """Create a horizontal flow diagram using a table"""
    row = []
    for i, (label, color) in enumerate(stages):
        if i > 0:
            row.append(Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                ParagraphStyle('arrow', alignment=TA_CENTER, parent=styles['Normal'])))
        row.append(Paragraph(
            f'<b><font color="white" size="8">{label}</font></b>',
            ParagraphStyle('flowbox', alignment=TA_CENTER, parent=styles['Normal'],
                          backColor=HexColor(color))
        ))

    n = len(stages)
    widths = []
    for i in range(2 * n - 1):
        widths.append(20 if i % 2 == 1 else (430 // n))

    t = Table([row], colWidths=widths)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        *[(('BACKGROUND', (i*2, 0), (i*2, 0), HexColor(stages[i][1]))) for i in range(n)],
        *[(('ROUNDEDCORNERS', [4, 4, 4, 4])) for _ in range(1)],
    ]))
    return t

def make_info_box(title, content, bg_color=LIGHT_BLUE, border_color=BLUE):
    """Create an info/tip box"""
    data = [[
        Paragraph(f'<b>{title}</b>', ParagraphStyle(
            'boxtitle', parent=styles['Normal'], fontSize=10,
            textColor=border_color, spaceAfter=4
        )),
    ], [
        Paragraph(content, ParagraphStyle(
            'boxcontent', parent=styles['Normal'], fontSize=9.5,
            leading=13, textColor=black
        ))
    ]]
    t = Table(data, colWidths=[465])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('BOX', (0, 0), (-1, -1), 1, border_color),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    return t

def make_field_table(fields):
    """Create a field reference table"""
    header = [
        Paragraph('<b>Field</b>', ParagraphStyle('th', parent=styles['Normal'], fontSize=9, textColor=white)),
        Paragraph('<b>Description</b>', ParagraphStyle('th', parent=styles['Normal'], fontSize=9, textColor=white)),
        Paragraph('<b>Required</b>', ParagraphStyle('th', parent=styles['Normal'], fontSize=9, textColor=white)),
    ]
    data = [header]
    for field, desc, req in fields:
        data.append([
            Paragraph(f'<b>{field}</b>', ParagraphStyle('td', parent=styles['Normal'], fontSize=9)),
            Paragraph(desc, ParagraphStyle('td', parent=styles['Normal'], fontSize=9)),
            Paragraph(req, ParagraphStyle('td', parent=styles['Normal'], fontSize=9,
                      textColor=RED if req == 'Yes' else GRAY)),
        ])
    t = Table(data, colWidths=[120, 270, 75])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


def build_pdf():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=55, rightMargin=55,
        topMargin=50, bottomMargin=50
    )
    story = []

    # ─── COVER PAGE ───
    story.append(Spacer(1, 80))
    story.append(Paragraph("PROCUREMENT MODULE", styles['CoverTitle']))
    story.append(Paragraph("User Manual &amp; Process Guide", styles['CoverSubtitle']))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="60%", thickness=2, color=BLUE, spaceAfter=20))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Mahakaushal Sugar &amp; Power Industries Ltd", ParagraphStyle(
        'company', parent=styles['Normal'], fontSize=14, textColor=DARK_BLUE,
        alignment=TA_CENTER, spaceAfter=8
    )))
    story.append(Paragraph("Distillery ERP System", ParagraphStyle(
        'system', parent=styles['Normal'], fontSize=12, textColor=GRAY,
        alignment=TA_CENTER, spaceAfter=30
    )))

    # Flow overview on cover
    story.append(Spacer(1, 30))
    cover_flow = [
        ("Vendor\nRegistration", "#1e40af"),
        ("Purchase\nOrder", "#7c3aed"),
        ("Goods\nReceipt", "#166534"),
        ("Vendor\nInvoice", "#c2410c"),
        ("Payment", "#dc2626"),
    ]
    flow_row = []
    for label, color in cover_flow:
        flow_row.append(Paragraph(
            f'<font color="white" size="9"><b>{label}</b></font>',
            ParagraphStyle('fc', alignment=TA_CENTER, parent=styles['Normal'])
        ))
    ft = Table([flow_row], colWidths=[90]*5)
    ft.setStyle(TableStyle([
        *[(('BACKGROUND', (i, 0), (i, 0), HexColor(cover_flow[i][1]))) for i in range(5)],
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(ft)

    story.append(Spacer(1, 60))
    story.append(Paragraph("Version 1.0 | March 2026", ParagraphStyle(
        'ver', parent=styles['Normal'], fontSize=10, textColor=GRAY,
        alignment=TA_CENTER
    )))
    story.append(Paragraph("SAP MM-Inspired Procure-to-Pay (P2P) Module", ParagraphStyle(
        'tag', parent=styles['Normal'], fontSize=10, textColor=BLUE,
        alignment=TA_CENTER, spaceBefore=8
    )))

    story.append(PageBreak())

    # ─── TABLE OF CONTENTS ───
    story.append(Paragraph("Table of Contents", styles['SectionTitle']))
    story.append(Spacer(1, 10))
    toc_items = [
        ("1.", "Process Overview &amp; Document Flow"),
        ("2.", "Vendor Registration"),
        ("3.", "Material Master"),
        ("4.", "Purchase Order (PO)"),
        ("5.", "Goods Receipt Note (GRN)"),
        ("6.", "Vendor Invoice &amp; 3-Way Matching"),
        ("7.", "Vendor Payment"),
        ("8.", "Indian GST Compliance"),
        ("9.", "Reports &amp; Dashboards"),
        ("10.", "Quick Reference Card"),
    ]
    for num, title in toc_items:
        story.append(Paragraph(
            f'<font color="#1e40af"><b>{num}</b></font>  {title}',
            styles['TOCEntry']
        ))
    story.append(PageBreak())

    # ─── 1. PROCESS OVERVIEW ───
    story.append(Paragraph("1. Process Overview &amp; Document Flow", styles['SectionTitle']))
    story.append(Paragraph(
        "The Procurement module follows the SAP MM-inspired Procure-to-Pay (P2P) cycle. "
        "Each document in the chain links to the previous one, creating a complete audit trail "
        "from vendor onboarding through final payment.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 8))

    # Full flow diagram
    story.append(Paragraph("Complete Document Flow", styles['SubSection']))
    flow_data = [
        [Paragraph('<font color="white" size="9"><b>1. Vendor<br/>Registration</b></font>',
                    ParagraphStyle('f1', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                    ParagraphStyle('arr', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font color="white" size="9"><b>2. Material<br/>Master</b></font>',
                    ParagraphStyle('f2', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                    ParagraphStyle('arr', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font color="white" size="9"><b>3. Purchase<br/>Order</b></font>',
                    ParagraphStyle('f3', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                    ParagraphStyle('arr', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font color="white" size="9"><b>4. Goods<br/>Receipt</b></font>',
                    ParagraphStyle('f4', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                    ParagraphStyle('arr', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font color="white" size="9"><b>5. Vendor<br/>Invoice</b></font>',
                    ParagraphStyle('f5', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font size="14" color="#6b7280">&rarr;</font>',
                    ParagraphStyle('arr', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('<font color="white" size="9"><b>6. Payment</b></font>',
                    ParagraphStyle('f6', alignment=TA_CENTER, parent=styles['Normal'])),
        ],
        # Location row
        [Paragraph('<font size="7" color="#6b7280">HQ</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('', styles['Normal']),
         Paragraph('<font size="7" color="#6b7280">HQ</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('', styles['Normal']),
         Paragraph('<font size="7" color="#6b7280">HQ</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('', styles['Normal']),
         Paragraph('<font size="7" color="#166534">Factory</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('', styles['Normal']),
         Paragraph('<font size="7" color="#6b7280">HQ</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
         Paragraph('', styles['Normal']),
         Paragraph('<font size="7" color="#6b7280">HQ</font>',
                    ParagraphStyle('loc', alignment=TA_CENTER, parent=styles['Normal'])),
        ]
    ]
    colors_list = ["#1e40af", "#374151", "#7c3aed", "#374151", "#166534", "#374151", "#0891b2", "#374151", "#c2410c", "#374151", "#dc2626"]
    ft2 = Table(flow_data, colWidths=[75, 18, 75, 18, 75, 18, 75, 18, 75, 18, 75])
    style_cmds = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
    ]
    for i in range(0, 11, 2):
        style_cmds.append(('BACKGROUND', (i, 0), (i, 0), HexColor(colors_list[i])))
    ft2.setStyle(TableStyle(style_cmds))
    story.append(ft2)
    story.append(Spacer(1, 12))

    story.append(make_info_box(
        "Key Principle: 3-Way Matching",
        "Every vendor invoice is automatically matched against the Purchase Order (price &amp; quantity agreed) "
        "and Goods Receipt Note (quantity actually received). Status shows as MATCHED, MISMATCH, or UNMATCHED. "
        "This prevents overpayment and fraud."
    ))
    story.append(Spacer(1, 10))

    # Status lifecycle
    story.append(Paragraph("Document Status Lifecycle", styles['SubSection']))
    status_data = [
        [Paragraph('<b>Document</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Status Flow</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        [Paragraph('Purchase Order', styles['BodyText2']),
         Paragraph('DRAFT &rarr; APPROVED &rarr; SENT &rarr; PARTIAL_RECEIVED &rarr; RECEIVED &rarr; CLOSED', styles['BodyText2'])],
        [Paragraph('Goods Receipt', styles['BodyText2']),
         Paragraph('DRAFT &rarr; CONFIRMED', styles['BodyText2'])],
        [Paragraph('Vendor Invoice', styles['BodyText2']),
         Paragraph('PENDING &rarr; VERIFIED &rarr; APPROVED &rarr; PAID', styles['BodyText2'])],
    ]
    st = Table(status_data, colWidths=[120, 345])
    st.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(st)
    story.append(PageBreak())

    # ─── 2. VENDOR REGISTRATION ───
    story.append(Paragraph("2. Vendor Registration", styles['SectionTitle']))
    story.append(Paragraph(
        "Before creating any Purchase Order, the vendor must be registered in the system. "
        "This captures all statutory, banking, and compliance details required for Indian tax filing.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("How to Register a Vendor", styles['SubSection']))
    story.append(make_step_table([
        ("Navigate to Procurement &rarr; Vendors", "Open the sidebar and expand the Procurement section. Click on Vendors."),
        ("Click 'Add New Vendor'", "The registration form will appear with all required fields."),
        ("Fill Basic Details", "Enter vendor name, trade name, category (Raw Material Supplier, Chemical Supplier, etc.), and contact information."),
        ("Enter GST &amp; Tax Details", "Enter GSTIN (15-digit), PAN, state code. Check 'RCM Applicable' for unregistered vendors. Check 'MSME' if applicable."),
        ("Enter Bank Details", "Bank name, branch, account number, IFSC code. Required for payment processing."),
        ("Set Payment &amp; TDS Terms", "Payment terms (COD/NET7/NET15/NET30), credit limit, credit days. Set TDS section (194C/194Q) and percentage if applicable."),
        ("Save", "Click 'Create Vendor'. The vendor is now available for Purchase Orders."),
    ]))
    story.append(Spacer(1, 8))

    story.append(make_info_box(
        "MSME Vendors",
        "MSME vendors must be paid within 45 days as per the MSME Development Act. "
        "Mark vendors as MSME and enter their registration number. The system tracks this for compliance.",
        LIGHT_GREEN, GREEN
    ))
    story.append(Spacer(1, 6))
    story.append(make_info_box(
        "Reverse Charge Mechanism (RCM)",
        "If a vendor is unregistered under GST, mark 'RCM Applicable'. The buyer (MSPIL) must pay GST directly "
        "to the government instead of the vendor. RCM amounts are tracked separately on invoices.",
        LIGHT_ORANGE, ORANGE
    ))
    story.append(PageBreak())

    # ─── 3. MATERIAL MASTER ───
    story.append(Paragraph("3. Material Master", styles['SectionTitle']))
    story.append(Paragraph(
        "The Material Master contains all items that can be purchased. Each material has an HSN code, "
        "GST rate, unit of measure, and stock tracking. The system comes pre-seeded with 12 common distillery materials.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Pre-Loaded Materials", styles['SubSection']))
    mat_data = [
        [Paragraph('<b>Material</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Category</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>HSN</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Unit</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>GST%</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        ['Maize', 'Raw Material', '1005', 'MT', '5%'],
        ['Broken Rice', 'Raw Material', '1006', 'MT', '5%'],
        ['Alpha Amylase', 'Chemical/Enzyme', '3507', 'LTR', '18%'],
        ['Gluco Amylase', 'Chemical/Enzyme', '3507', 'LTR', '18%'],
        ['Yeast', 'Chemical', '2102', 'KG', '18%'],
        ['Sulphuric Acid', 'Chemical', '2807', 'KG', '18%'],
        ['Urea', 'Chemical', '3102', 'KG', '5%'],
        ['Antifoam', 'Chemical', '3402', 'LTR', '18%'],
        ['HSD/Diesel', 'Fuel', '2710', 'LTR', '0%'],
        ['Furnace Oil', 'Fuel', '2710', 'KL', '18%'],
        ['PP Bags', 'Packing', '3923', 'NOS', '18%'],
        ['HDPE Bags', 'Packing', '3923', 'NOS', '18%'],
    ]
    for i in range(1, len(mat_data)):
        mat_data[i] = [Paragraph(str(c), ParagraphStyle('td', fontSize=9, parent=styles['Normal'])) for c in mat_data[i]]
    mt = Table(mat_data, colWidths=[100, 100, 55, 50, 50])
    mt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(mt)
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "To add a new material, navigate to Procurement &rarr; Materials and click 'Add New Material'. "
        "Enter the material name, category, HSN code, unit, GST rate, and minimum stock level.",
        styles['BodyText2']
    ))
    story.append(PageBreak())

    # ─── 4. PURCHASE ORDER ───
    story.append(Paragraph("4. Purchase Order (PO)", styles['SectionTitle']))
    story.append(Paragraph(
        "Purchase Orders authorize the purchase of materials from registered vendors. "
        "The PO captures pricing, GST calculations, delivery terms, and TDS applicability. "
        "GST is auto-calculated per line item based on the supply type.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Creating a Purchase Order", styles['SubSection']))
    story.append(make_step_table([
        ("Navigate to Procurement &rarr; Purchase Orders", "Click 'Create Purchase Order' button."),
        ("Select Vendor", "Choose from registered vendors. TDS details auto-populate from vendor master."),
        ("Set Header Details", "PO Date, Expected Delivery Date, Supply Type (Intra-State for MP, Inter-State for others), Payment Terms, Delivery Address."),
        ("Add Line Items", "Select material (HSN/Unit/GST auto-fill), enter Quantity and Rate. Discount % is optional. GST breakdown auto-calculates."),
        ("Review Totals", "System shows: Subtotal, CGST, SGST (or IGST), Freight, Other Charges, TDS deduction, Grand Total."),
        ("Save as Draft", "PO is created in DRAFT status. Review before approving."),
        ("Approve PO", "Click 'Approve' to move to APPROVED. Then 'Send to Vendor' to mark SENT."),
    ]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("GST Calculation on PO Lines", styles['SubSection']))
    story.append(make_info_box(
        "Intra-State (within Madhya Pradesh)",
        "GST is split equally: CGST = GST%/2 and SGST = GST%/2. Example: 18% GST on Rs.10,000 = Rs.900 CGST + Rs.900 SGST = Rs.1,800 total GST."
    ))
    story.append(Spacer(1, 4))
    story.append(make_info_box(
        "Inter-State (from other states)",
        "Full IGST applies: IGST = GST%. Example: 18% GST on Rs.10,000 = Rs.1,800 IGST.",
        LIGHT_ORANGE, ORANGE
    ))
    story.append(PageBreak())

    # ─── 5. GOODS RECEIPT NOTE ───
    story.append(Paragraph("5. Goods Receipt Note (GRN)", styles['SectionTitle']))
    story.append(Paragraph(
        "When materials arrive at the factory, a Goods Receipt is created against the Purchase Order. "
        "This records what was actually received, enables quality inspection, and automatically updates stock levels.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Creating a Goods Receipt", styles['SubSection']))
    story.append(make_step_table([
        ("Navigate to Procurement &rarr; Goods Receipt", "Click 'Create GRN'. System shows POs with pending quantities."),
        ("Select PO", "Choose the Purchase Order. Pending line items auto-populate with quantities and rates."),
        ("Enter Vehicle &amp; Challan Details", "Vehicle number, vendor challan number, challan date, E-Way Bill number."),
        ("Enter Received Quantities", "For each line: Received Qty, Accepted Qty, Rejected Qty. Accepted qty updates stock."),
        ("Save GRN", "GRN is created in DRAFT. Stock is updated immediately. PO status changes to PARTIAL_RECEIVED or RECEIVED."),
        ("Quality Inspection (Optional)", "Update quality status: ACCEPTED, REJECTED, or PARTIAL_ACCEPTED with remarks."),
        ("Confirm GRN", "Move to CONFIRMED status to finalize the receipt."),
    ]))
    story.append(Spacer(1, 8))

    story.append(make_info_box(
        "Automatic Stock Update",
        "When a GRN is saved, the accepted quantity is immediately added to the Material Master's current stock. "
        "The PO line's pending quantity is reduced accordingly. When all lines are fully received, the PO moves to RECEIVED.",
        LIGHT_GREEN, GREEN
    ))
    story.append(PageBreak())

    # ─── 6. VENDOR INVOICE ───
    story.append(Paragraph("6. Vendor Invoice &amp; 3-Way Matching", styles['SectionTitle']))
    story.append(Paragraph(
        "When the vendor sends their invoice, it is recorded and automatically matched against "
        "the PO and GRN. The system calculates GST, TDS, and net payable amount.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Recording a Vendor Invoice", styles['SubSection']))
    story.append(make_step_table([
        ("Navigate to Procurement &rarr; Vendor Invoices", "Click 'Create Invoice'."),
        ("Select Vendor, PO, and GRN", "Link the invoice to its source documents for 3-way matching."),
        ("Enter Vendor Invoice Details", "Vendor's invoice number, vendor invoice date, our booking date, due date."),
        ("Enter Line Details", "Product name, quantity, unit, rate. Supply Type and GST% for tax calculation."),
        ("Check RCM if Applicable", "If vendor is unregistered, check RCM. GST liability shifts to MSPIL."),
        ("Add Charges", "Freight, loading charge, other charges, round off. Enter TDS section and %."),
        ("Review Computed Amounts", "System shows: Subtotal, GST split, RCM amounts, Total, TDS deduction, Net Payable."),
        ("Save", "Invoice created as PENDING with match status (MATCHED/MISMATCH/UNMATCHED)."),
    ]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("3-Way Match Status", styles['SubSection']))
    match_data = [
        [Paragraph('<b>Status</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Meaning</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Action</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        [Paragraph('<font color="#166534"><b>MATCHED</b></font>', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('PO qty = GRN qty = Invoice qty', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('Safe to approve and pay', ParagraphStyle('td', fontSize=9, parent=styles['Normal']))],
        [Paragraph('<font color="#dc2626"><b>MISMATCH</b></font>', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('Quantities do not match across documents', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('Investigate before approving', ParagraphStyle('td', fontSize=9, parent=styles['Normal']))],
        [Paragraph('<font color="#6b7280"><b>UNMATCHED</b></font>', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('PO or GRN not linked', ParagraphStyle('td', fontSize=9, parent=styles['Normal'])),
         Paragraph('Link documents or approve manually', ParagraphStyle('td', fontSize=9, parent=styles['Normal']))],
    ]
    mmt = Table(match_data, colWidths=[100, 200, 165])
    mmt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(mmt)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Invoice Approval Workflow", styles['SubSection']))
    story.append(Paragraph(
        "PENDING &rarr; <b>Verify</b> (accounts team checks details) &rarr; <b>Approve</b> (manager authorizes) &rarr; <b>Paid</b> (after payment recorded). "
        "Only APPROVED invoices can receive payments.",
        styles['BodyText2']
    ))
    story.append(PageBreak())

    # ─── 7. VENDOR PAYMENT ───
    story.append(Paragraph("7. Vendor Payment", styles['SectionTitle']))
    story.append(Paragraph(
        "Payments are recorded against approved vendor invoices. The system supports TDS deduction, "
        "multiple payment modes, advance payments, and maintains a complete vendor ledger.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Recording a Payment", styles['SubSection']))
    story.append(make_step_table([
        ("Go to Procurement &rarr; Vendor Payments", "Select the 'Record Payment' tab."),
        ("Select Vendor", "Choose the vendor. Their approved invoices with outstanding balances will load."),
        ("Select Invoice", "Pick the invoice to pay. Balance amount is displayed."),
        ("Enter Payment Details", "Amount, payment mode (Cash/Cheque/Bank Transfer/UPI/DD), reference number (UTR/cheque no)."),
        ("TDS Deduction", "If vendor has TDS applicable, enter TDS amount deducted and section (194C/194Q)."),
        ("Advance Payment (Optional)", "Check 'Advance' if paying without an invoice. Can be adjusted against future invoices."),
        ("Submit", "Payment is recorded. Invoice balance is updated. If fully paid, invoice status changes to PAID."),
    ]))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Vendor Ledger", styles['SubSection']))
    story.append(Paragraph(
        "The <b>Vendor Ledger</b> tab shows a complete timeline of all invoices and payments for a selected vendor, "
        "with running balance. Use this for reconciliation and vendor statement comparison.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 4))

    story.append(Paragraph("Outstanding Report", styles['SubSection']))
    story.append(Paragraph(
        "The <b>Outstanding</b> tab shows all vendors with unpaid invoices, sorted by highest outstanding first. "
        "Use this to prioritize payments, especially for MSME vendors who must be paid within 45 days.",
        styles['BodyText2']
    ))
    story.append(PageBreak())

    # ─── 8. INDIAN GST COMPLIANCE ───
    story.append(Paragraph("8. Indian GST Compliance", styles['SectionTitle']))
    story.append(Paragraph(
        "The procurement module is built with full Indian GST compliance including CGST/SGST/IGST split, "
        "Reverse Charge Mechanism, Input Tax Credit tracking, and TDS under sections 194C and 194Q.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    gst_data = [
        [Paragraph('<b>Feature</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Description</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Where in System</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        ['CGST + SGST', 'Intra-state supply (within MP)', 'PO lines, Vendor Invoice'],
        ['IGST', 'Inter-state supply (other states)', 'PO lines, Vendor Invoice'],
        ['HSN Codes', '4-8 digit commodity codes', 'Material Master, PO lines'],
        ['RCM', 'Reverse Charge for unregistered vendors', 'Vendor Master, Vendor Invoice'],
        ['ITC', 'Input Tax Credit eligibility tracking', 'Vendor Invoice, ITC Report'],
        ['TDS 194C', 'TDS on contractor payments (1-2%)', 'Vendor Master, Payment'],
        ['TDS 194Q', 'TDS on purchase of goods (0.1%)', 'Vendor Master, Payment'],
        ['E-Way Bill', 'Transport document for goods > Rs.50,000', 'Goods Receipt'],
        ['MSME Tracking', 'Priority payment within 45 days', 'Vendor Master'],
    ]
    for i in range(1, len(gst_data)):
        gst_data[i] = [Paragraph(str(c), ParagraphStyle('td', fontSize=9, parent=styles['Normal'])) for c in gst_data[i]]
    gt = Table(gst_data, colWidths=[100, 200, 165])
    gt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(gt)
    story.append(PageBreak())

    # ─── 9. REPORTS ───
    story.append(Paragraph("9. Reports &amp; Dashboards", styles['SectionTitle']))
    story.append(Paragraph(
        "Each procurement page includes a dashboard with key metrics. Additionally, specialized reports "
        "are available for tax compliance and financial tracking.",
        styles['BodyText2']
    ))
    story.append(Spacer(1, 6))

    reports_data = [
        [Paragraph('<b>Report</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Location</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Key Metrics</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        ['ITC Report', 'Vendor Invoices page', 'Eligible ITC, Claimed/Unclaimed, RCM amounts'],
        ['TDS Report', 'Vendor Payments page', 'TDS deducted by section, vendor-wise breakdown'],
        ['Outstanding Report', 'Vendor Payments page', 'Vendor-wise outstanding, overdue invoices'],
        ['Vendor Ledger', 'Vendor Payments page', 'Complete debit/credit timeline, running balance'],
        ['PO Summary', 'Purchase Orders page', 'Draft/Approved/Sent/Received counts, total value'],
        ['GRN Summary', 'Goods Receipt page', 'Pending quality check, confirmed receipts'],
    ]
    for i in range(1, len(reports_data)):
        reports_data[i] = [Paragraph(str(c), ParagraphStyle('td', fontSize=9, parent=styles['Normal'])) for c in reports_data[i]]
    rt = Table(reports_data, colWidths=[110, 130, 225])
    rt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(rt)
    story.append(PageBreak())

    # ─── 10. QUICK REFERENCE ───
    story.append(Paragraph("10. Quick Reference Card", styles['SectionTitle']))
    story.append(Spacer(1, 6))

    story.append(Paragraph("Daily Workflow Checklist", styles['SubSection']))
    checklist = [
        ("Morning", "Check Outstanding report for overdue vendor payments. Prioritize MSME vendors."),
        ("On Material Arrival", "Create GRN against PO. Record vehicle/challan details. Inspect quality."),
        ("On Receiving Vendor Invoice", "Create Vendor Invoice. Link to PO and GRN. Verify 3-way match."),
        ("Invoice Processing", "Verify &rarr; Approve matched invoices. Investigate mismatches before approval."),
        ("Payment Day", "Record payments against approved invoices. Deduct TDS where applicable."),
        ("End of Day", "Review pending POs. Check material stock levels against minimum."),
    ]
    story.append(make_step_table(checklist))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Navigation Quick Reference", styles['SubSection']))
    nav_data = [
        [Paragraph('<b>Task</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal'])),
         Paragraph('<b>Path</b>', ParagraphStyle('th', fontSize=9, textColor=white, parent=styles['Normal']))],
        ['Register a new vendor', 'Sidebar &rarr; Procurement &rarr; Vendors &rarr; Add New Vendor'],
        ['Create a Purchase Order', 'Sidebar &rarr; Procurement &rarr; Purchase Orders &rarr; Create PO'],
        ['Record material receipt', 'Sidebar &rarr; Procurement &rarr; Goods Receipt &rarr; Create GRN'],
        ['Book vendor invoice', 'Sidebar &rarr; Procurement &rarr; Vendor Invoices &rarr; Create Invoice'],
        ['Make payment', 'Sidebar &rarr; Procurement &rarr; Vendor Payments &rarr; Record Payment'],
        ['View vendor ledger', 'Sidebar &rarr; Procurement &rarr; Vendor Payments &rarr; Vendor Ledger tab'],
        ['Check outstanding', 'Sidebar &rarr; Procurement &rarr; Vendor Payments &rarr; Outstanding tab'],
        ['Add new material', 'Sidebar &rarr; Procurement &rarr; Materials &rarr; Add New Material'],
    ]
    for i in range(1, len(nav_data)):
        nav_data[i] = [Paragraph(str(c), ParagraphStyle('td', fontSize=9, parent=styles['Normal'])) for c in nav_data[i]]
    nt = Table(nav_data, colWidths=[160, 305])
    nt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT_GRAY]),
        ('BOX', (0, 0), (-1, -1), 0.5, GRAY),
        ('LINEBELOW', (0, 0), (-1, -1), 0.3, HexColor("#e5e7eb")),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(nt)
    story.append(Spacer(1, 20))

    story.append(HRFlowable(width="100%", thickness=1, color=GRAY, spaceAfter=12))
    story.append(Paragraph(
        "<i>For technical support or system issues, contact the ERP admin team.</i>",
        ParagraphStyle('footer_note', parent=styles['Normal'], fontSize=9,
                       textColor=GRAY, alignment=TA_CENTER)
    ))

    # Build
    doc.build(story)
    print(f"PDF created: {OUTPUT}")

if __name__ == "__main__":
    build_pdf()
