#!/usr/bin/env python3
"""Generate DDGS Logistics & Dispatch Process Flow PDF"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus.flowables import Flowable
import os

OUTPUT = os.path.join(os.path.dirname(__file__), "DDGS_Logistics_Process.pdf")

# Colors
NAVY = HexColor("#1e3a5f")
BLUE = HexColor("#2563eb")
LIGHT_BLUE = HexColor("#eff6ff")
ORANGE = HexColor("#ea580c")
LIGHT_ORANGE = HexColor("#fff7ed")
GREEN = HexColor("#16a34a")
LIGHT_GREEN = HexColor("#f0fdf4")
GRAY = HexColor("#6b7280")
DARK = HexColor("#1f2937")
WHITE = HexColor("#ffffff")
YELLOW_BG = HexColor("#fefce8")
RED = HexColor("#dc2626")

styles = getSampleStyleSheet()

# Custom styles
title_style = ParagraphStyle('CustomTitle', parent=styles['Title'],
    fontSize=22, textColor=NAVY, spaceAfter=4*mm, fontName='Helvetica-Bold')

subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'],
    fontSize=12, textColor=GRAY, spaceAfter=8*mm, alignment=TA_CENTER)

h1 = ParagraphStyle('H1', parent=styles['Heading1'],
    fontSize=16, textColor=NAVY, spaceBefore=8*mm, spaceAfter=4*mm,
    fontName='Helvetica-Bold', borderWidth=0, borderPadding=0)

h2 = ParagraphStyle('H2', parent=styles['Heading2'],
    fontSize=13, textColor=BLUE, spaceBefore=6*mm, spaceAfter=3*mm,
    fontName='Helvetica-Bold')

h3 = ParagraphStyle('H3', parent=styles['Heading3'],
    fontSize=11, textColor=ORANGE, spaceBefore=4*mm, spaceAfter=2*mm,
    fontName='Helvetica-Bold')

body = ParagraphStyle('Body', parent=styles['Normal'],
    fontSize=10, textColor=DARK, leading=15, spaceAfter=3*mm, alignment=TA_JUSTIFY)

body_indent = ParagraphStyle('BodyIndent', parent=body, leftIndent=8*mm)

bullet = ParagraphStyle('Bullet', parent=body, leftIndent=10*mm, bulletIndent=4*mm)

note_style = ParagraphStyle('Note', parent=body,
    fontSize=9, textColor=HexColor("#92400e"), leftIndent=6*mm, rightIndent=6*mm,
    backColor=YELLOW_BG, borderPadding=6, spaceAfter=4*mm, spaceBefore=2*mm)

step_num_style = ParagraphStyle('StepNum', parent=styles['Normal'],
    fontSize=11, textColor=WHITE, fontName='Helvetica-Bold', alignment=TA_CENTER)

step_title_style = ParagraphStyle('StepTitle', parent=styles['Normal'],
    fontSize=11, textColor=NAVY, fontName='Helvetica-Bold')

step_body_style = ParagraphStyle('StepBody', parent=styles['Normal'],
    fontSize=9.5, textColor=DARK, leading=13)


class StepBox(Flowable):
    """A numbered step with title and description"""
    def __init__(self, num, title, desc, color=BLUE, width=170*mm):
        Flowable.__init__(self)
        self.num = num
        self.title = title
        self.desc = desc
        self.color = color
        self.box_width = width

    def wrap(self, availWidth, availHeight):
        self.width = min(self.box_width, availWidth)
        # Estimate height
        self.height = max(20*mm, 14*mm + len(self.desc) * 0.15*mm)
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        # Number circle
        c.setFillColor(self.color)
        c.circle(8*mm, h - 8*mm, 5*mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(8*mm, h - 10.5*mm, str(self.num))

        # Title
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(16*mm, h - 9.5*mm, self.title)

        # Description
        c.setFillColor(DARK)
        c.setFont("Helvetica", 9.5)
        y = h - 16*mm
        for line in self.desc.split('\n'):
            if y < 0:
                break
            c.drawString(16*mm, y, line)
            y -= 4*mm


def make_step_table(num, title, desc, color=BLUE):
    """Create a step as a table row for better layout control"""
    num_para = Paragraph(f'<font color="white"><b>{num}</b></font>',
        ParagraphStyle('sn', alignment=TA_CENTER, fontSize=12, fontName='Helvetica-Bold'))
    title_para = Paragraph(f'<b>{title}</b>', step_title_style)
    desc_para = Paragraph(desc, step_body_style)

    content = [[title_para], [desc_para]]
    inner = Table(content, colWidths=[150*mm])
    inner.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 1),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
    ]))

    num_table = Table([[num_para]], colWidths=[10*mm], rowHeights=[10*mm])
    num_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), color),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ('VALIGN', (0, 0), (0, 0), 'MIDDLE'),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
    ]))

    t = Table([[num_table, inner]], colWidths=[14*mm, 152*mm])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2*mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2*mm),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_BLUE),
        ('ROUNDEDCORNERS', [4, 4, 4, 4]),
        ('BOX', (0, 0), (-1, -1), 0.5, HexColor("#bfdbfe")),
    ]))
    return t


def build_pdf():
    doc = SimpleDocTemplate(OUTPUT, pagesize=A4,
        topMargin=20*mm, bottomMargin=20*mm,
        leftMargin=18*mm, rightMargin=18*mm)

    story = []

    # ── TITLE PAGE ──
    story.append(Spacer(1, 30*mm))
    story.append(Paragraph("DDGS Sale & Dispatch", title_style))
    story.append(Paragraph("Logistics Process Flow", ParagraphStyle('t2',
        parent=title_style, fontSize=18, textColor=BLUE)))
    story.append(Spacer(1, 4*mm))
    story.append(HRFlowable(width="60%", color=BLUE, thickness=2))
    story.append(Spacer(1, 6*mm))
    story.append(Paragraph("MSPIL Ethanol Plant — Internal Process Document", subtitle_style))
    story.append(Paragraph("For team review & discussion before ERP implementation",
        ParagraphStyle('sub2', parent=subtitle_style, fontSize=10, textColor=GRAY)))
    story.append(Spacer(1, 20*mm))

    # Overview box
    overview = """This document describes the end-to-end logistics process for DDGS (Dried Distillers Grains with Solubles)
    sales — from the moment HQ books a sale order to when the transporter receives payment.
    It covers the roles of HQ, logistics team, factory floor, and the buyer's destination."""

    ov_table = Table([[Paragraph(overview, ParagraphStyle('ov', parent=body, textColor=NAVY, fontSize=10))]],
        colWidths=[160*mm])
    ov_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), LIGHT_BLUE),
        ('BOX', (0, 0), (0, 0), 1, BLUE),
        ('TOPPADDING', (0, 0), (0, 0), 4*mm),
        ('BOTTOMPADDING', (0, 0), (0, 0), 4*mm),
        ('LEFTPADDING', (0, 0), (0, 0), 4*mm),
        ('RIGHTPADDING', (0, 0), (0, 0), 4*mm),
    ]))
    story.append(ov_table)
    story.append(Spacer(1, 10*mm))

    # Key roles
    story.append(Paragraph("<b>Key Roles</b>", h2))
    roles_data = [
        ["Role", "Responsibility"],
        ["HQ / Sales", "Books orders, negotiates price, decides transport mode"],
        ["Logistics Team", "Arranges transporters, manages truck flow, tracks delivery"],
        ["Factory (Plant)", "Loads trucks, weighbridge, issues e-way bill & challan"],
        ["Buyer (Destination)", "Receives goods, confirms delivery, sends receipt"],
        ["Transporter", "Provides trucks, delivers goods, receives freight payment"],
    ]
    roles_table = Table(roles_data, colWidths=[40*mm, 126*mm])
    roles_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9.5),
        ('BACKGROUND', (0, 1), (-1, -1), WHITE),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ('TOPPADDING', (0, 0), (-1, -1), 3*mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3*mm),
        ('LEFTPADDING', (0, 0), (-1, -1), 3*mm),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, HexColor("#f9fafb")]),
    ]))
    story.append(roles_table)

    story.append(PageBreak())

    # ── PROCESS FLOW ──
    story.append(Paragraph("Complete Process Flow", h1))
    story.append(Paragraph(
        "The DDGS sale follows this sequence from order booking to transporter payment.", body))

    # PHASE 1: ORDER BOOKING
    story.append(Paragraph("Phase 1 — Order Booking (HQ)", h2))

    story.append(make_step_table(1, "HQ Books Sale Order",
        "Sales team at HQ books a DDGS sale order. This is typically done via phone/WhatsApp "
        "with the buyer. Details captured: buyer name, quantity (MT), rate per MT, GST %, "
        "delivery location, and payment terms (advance / NET 15 / NET 30)."))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(2, "Transport Mode Decision",
        "HQ decides who arranges transport:<br/>"
        "<b>Option A — \"Transport By Us\"</b>: Our logistics team arranges trucks. "
        "Freight cost is either included in rate or charged separately.<br/>"
        "<b>Option B — \"Transport By Buyer\"</b>: Buyer sends their own trucks. "
        "We just load and release. Skip to Phase 3 (Factory Loading)."))
    story.append(Spacer(1, 2*mm))

    story.append(Paragraph(
        "<b>Note:</b> In the ERP, creating a Sale Order automatically sends it to the "
        "Logistics/Dispatch module. No manual handoff needed.", note_style))

    # PHASE 2: LOGISTICS ARRANGEMENT
    story.append(Paragraph("Phase 2 — Logistics Arrangement", h2))
    story.append(Paragraph(
        "<i>This phase only applies when transport is \"By Us\".</i>",
        ParagraphStyle('italic', parent=body, textColor=GRAY, fontSize=9.5)))

    story.append(make_step_table(3, "Logistics Team Receives Order",
        "The dispatch/logistics team sees the new order in their dashboard. "
        "They review: product, quantity, destination, and delivery deadline."))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(4, "Contact Approved Transporters",
        "Logistics contacts registered transporters to get trucks. "
        "Two types of transporters:<br/><br/>"
        "<b>GST Transporter</b> (Large/Registered): Has GST number, issues proper tax invoice "
        "for freight. Used for large or regular shipments. Can claim input tax credit.<br/><br/>"
        "<b>PAN Transporter</b> (Small/Unregistered): Only has PAN, no GST registration. "
        "Used for smaller/local runs. No GST invoice — we may need to pay reverse charge GST.",
        color=ORANGE))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(5, "Get Quotation & Conditions",
        "Transporter provides a quotation with:<br/>"
        "- Freight rate (per MT or per trip)<br/>"
        "- Loading/unloading charges (if any)<br/>"
        "- Transit time commitment<br/>"
        "- Payment terms (advance / on delivery / credit days)<br/>"
        "- Any special conditions (min load, waiting charges, etc.)"))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(6, "Assign Trucks to Factory",
        "Once transporter is finalized, logistics team inputs the number of trucks "
        "expected at the factory, with approximate arrival schedule. "
        "Factory team can now see incoming trucks on their dispatch dashboard."))
    story.append(Spacer(1, 2*mm))

    story.append(PageBreak())

    # PHASE 3: FACTORY LOADING
    story.append(Paragraph("Phase 3 — Factory Loading & Weighbridge", h2))

    story.append(make_step_table(7, "Truck Arrives at Factory Gate",
        "Truck arrives at the factory gate. Driver presents a <b>Bulti / GR (Guarantee Receipt)</b> — "
        "a document from the transporter confirming truck details. "
        "Gate records: vehicle number, driver name, mobile, transporter name, gate-in time.",
        color=GREEN))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(8, "Weighbridge — Tare Weight (Empty Truck)",
        "Empty truck goes to the weighbridge. <b>Tare weight</b> is recorded (weight of "
        "empty truck). Typically 10,000 - 15,000 kg depending on truck size.",
        color=GREEN))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(9, "Loading DDGS",
        "Factory floor team loads DDGS onto the truck from the DDGS godown. "
        "Loading crew fills the truck to capacity (typically 25-30 MT per truck). "
        "Quality check may be done at this stage.",
        color=GREEN))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(10, "Weighbridge — Gross Weight (Loaded Truck)",
        "Loaded truck returns to weighbridge. <b>Gross weight</b> is recorded. "
        "System automatically calculates:<br/>"
        "<b>Net Weight = Gross Weight - Tare Weight</b><br/>"
        "Example: Gross 37,800 kg - Tare 12,500 kg = Net 25,300 kg (25.3 MT)<br/>"
        "This net weight is the actual dispatched quantity used for invoicing.",
        color=GREEN))
    story.append(Spacer(1, 2*mm))

    # PHASE 4: DOCUMENTATION & RELEASE
    story.append(Paragraph("Phase 4 — Documentation & Truck Release", h2))

    story.append(make_step_table(11, "Factory Issues Documents",
        "Before the truck leaves, factory prepares THREE key documents:<br/><br/>"
        "<b>1. Delivery Challan</b> — Goods delivery note with product, quantity, "
        "vehicle details.<br/>"
        "<b>2. E-Way Bill</b> — Government-mandated electronic waybill for goods movement "
        "(required for goods value > Rs 50,000). Generated on the GST portal.<br/>"
        "<b>3. GR (Guarantee Receipt) / Bilti</b> — Transport document filled by factory, "
        "given to driver. Contains shipment details for the transporter's records.",
        color=ORANGE))
    story.append(Spacer(1, 2*mm))

    eway_note = (
        "<b>E-Way Bill Rule:</b> Once generated, the truck must reach the destination "
        "within the validity period. For DDGS (typically within-state or nearby), "
        "validity is approximately <b>1 day per 200 km</b> (usually 1-3 days). "
        "If the truck doesn't reach in time, the e-way bill must be extended or a new one generated. "
        "Penalties apply for expired e-way bills."
    )
    story.append(Paragraph(eway_note, note_style))

    story.append(make_step_table(12, "Gate Out — Truck Released",
        "Truck exits the factory gate. Gate records exit time. "
        "Gate pass number is issued. Truck is now in transit to the buyer's destination.",
        color=ORANGE))
    story.append(Spacer(1, 2*mm))

    story.append(PageBreak())

    # PHASE 5: DELIVERY CONFIRMATION
    story.append(Paragraph("Phase 5 — Delivery & Confirmation", h2))

    story.append(make_step_table(13, "Truck Reaches Destination",
        "Truck arrives at the buyer's location. Buyer's team unloads and may re-weigh "
        "at their own weighbridge. Any weight discrepancy is noted.",
        color=BLUE))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(14, "Destination Confirms to Logistics",
        "Buyer's receiving team (or our person at destination) confirms delivery to "
        "the logistics head. Confirmation includes: arrival time, unloaded weight, "
        "any quality issues or rejections.",
        color=BLUE))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(15, "Delivery Receipt Sent to Logistics",
        "Destination people send a <b>delivery receipt / POD (Proof of Delivery)</b> "
        "back to the logistics team. This receipt is needed for:<br/>"
        "- Closing the shipment in the system<br/>"
        "- Transporter payment processing<br/>"
        "- Resolving any disputes",
        color=BLUE))
    story.append(Spacer(1, 2*mm))

    # PHASE 6: BILLING & PAYMENT
    story.append(Paragraph("Phase 6 — Billing & Payments", h2))

    story.append(make_step_table(16, "Generate Invoice to Buyer",
        "Invoice is generated based on <b>actual weighbridge net weight</b> (not the "
        "ordered quantity). Invoice includes: product, quantity (MT), rate, GST (5% for DDGS), "
        "freight charges (if applicable), e-way bill reference, challan number.<br/>"
        "Example: 25.3 MT x Rs 18,000/MT = Rs 4,55,400 + 5% GST Rs 22,770 = Rs 4,78,170",
        color=HexColor("#7c3aed")))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(17, "Collect Payment from Buyer",
        "Payment collected as per agreed terms (advance / NET 15 / NET 30). "
        "Modes: NEFT, RTGS, cheque, or cash. UTR / reference number recorded. "
        "System marks invoice as PAID once full amount received.",
        color=HexColor("#7c3aed")))
    story.append(Spacer(1, 2*mm))

    story.append(make_step_table(18, "Transporter Payment",
        "After delivery is confirmed and receipt received, transporter freight "
        "payment is processed. Payment details:<br/>"
        "- GST transporter: Against their freight invoice (with GST)<br/>"
        "- PAN transporter: Against receipt/voucher (may need TDS deduction + reverse charge GST)<br/>"
        "- Mode: NEFT/RTGS to transporter's bank account",
        color=HexColor("#7c3aed")))
    story.append(Spacer(1, 2*mm))

    story.append(PageBreak())

    # ── SUMMARY FLOW DIAGRAM (text-based) ──
    story.append(Paragraph("Summary — Document Flow", h1))

    flow_data = [
        ["Stage", "Action", "Documents", "System Status"],
        ["1. Order", "HQ books DDGS sale", "Sale Order", "SO: CONFIRMED"],
        ["2. Logistics", "Arrange transporter & trucks", "Quotation, Truck schedule", "DR: SCHEDULED"],
        ["3. Gate In", "Truck arrives, driver gives bulti", "GR / Bulti", "Shipment: GATE_IN"],
        ["4. Tare", "Empty truck weighed", "Weighbridge slip", "TARE_WEIGHED"],
        ["5. Loading", "DDGS loaded onto truck", "—", "LOADING"],
        ["6. Gross", "Loaded truck weighed", "Weighbridge slip", "GROSS_WEIGHED"],
        ["7. Release", "Challan + E-way bill issued", "Challan, E-way Bill, GR", "RELEASED"],
        ["8. Exit", "Truck leaves factory", "Gate pass", "EXITED"],
        ["9. Delivery", "Truck reaches buyer", "POD / Receipt", "DELIVERED"],
        ["10. Invoice", "Bill generated on net weight", "Tax Invoice", "Invoice: CREATED"],
        ["11. Payment", "Buyer pays, transporter paid", "UTR, Payment receipt", "PAID"],
    ]

    flow_table = Table(flow_data, colWidths=[22*mm, 44*mm, 44*mm, 38*mm])
    flow_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTSIZE', (0, 1), (-1, -1), 8.5),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5*mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5*mm),
        ('LEFTPADDING', (0, 0), (-1, -1), 2*mm),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, HexColor("#f9fafb")]),
    ]))
    story.append(flow_table)
    story.append(Spacer(1, 8*mm))

    # Transporter types comparison
    story.append(Paragraph("Transporter Types — Quick Reference", h2))

    trans_data = [
        ["", "GST Transporter (Large)", "PAN Transporter (Small)"],
        ["Registration", "GST + PAN registered", "PAN only (no GST)"],
        ["Invoice", "Issues GST tax invoice for freight", "Receipt/voucher only"],
        ["GST on Freight", "Charged by transporter, we claim ITC", "We pay under Reverse Charge Mechanism (RCM)"],
        ["TDS", "Standard TDS rules", "TDS applicable on payment"],
        ["Typical Use", "Regular/large volume routes", "Local/small/ad-hoc runs"],
        ["Fleet", "Multiple trucks, organized fleet", "1-5 trucks, owner-operator"],
        ["Payment", "Credit terms (15-30 days)", "Usually immediate or advance"],
    ]

    trans_table = Table(trans_data, colWidths=[32*mm, 62*mm, 62*mm])
    trans_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('BACKGROUND', (0, 1), (0, -1), HexColor("#f3f4f6")),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5*mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5*mm),
        ('LEFTPADDING', (0, 0), (-1, -1), 2*mm),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, HexColor("#f9fafb")]),
    ]))
    story.append(trans_table)
    story.append(Spacer(1, 8*mm))

    # Discussion points
    story.append(Paragraph("Discussion Points for Team", h2))

    discussion_items = [
        "<b>Transporter Rate Master:</b> Should we maintain a rate master per transporter per route? "
        "Or negotiate fresh each time?",
        "<b>Advance Payment:</b> Some small transporters need advance before sending truck. "
        "How do we handle advance freight in the system?",
        "<b>Weight Discrepancy:</b> If buyer's weighbridge shows different weight than ours, "
        "which weight do we bill on? What's the acceptable tolerance?",
        "<b>E-Way Bill Expiry:</b> Who monitors e-way bill validity? Should the system alert "
        "if a truck hasn't reached in time?",
        "<b>Multiple Trucks per SO:</b> One sale order may need 10-12 trucks over multiple days. "
        "Each truck = one shipment with its own weighbridge entry, challan, and e-way bill.",
        "<b>Transporter Payment Cycle:</b> When exactly is transporter paid — on delivery confirmation? "
        "On receipt of POD? Monthly settlement?",
        "<b>Quality Rejection:</b> If buyer rejects goods at destination, what's the process? "
        "Return load? Discount?",
        "<b>Spot Sale:</b> For walk-in cash buyers at factory gate — is the process simpler? "
        "Skip logistics phase entirely?",
    ]

    for i, item in enumerate(discussion_items):
        num = str(i + 1)
        row = Table(
            [[Paragraph(f'<font color="{ORANGE.hexval()}">{num}.</font>', body),
              Paragraph(item, ParagraphStyle('di', parent=body, fontSize=9.5))]],
            colWidths=[8*mm, 150*mm]
        )
        row.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 1*mm),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1*mm),
        ]))
        story.append(row)

    story.append(Spacer(1, 10*mm))
    story.append(HRFlowable(width="100%", color=GRAY, thickness=0.5))
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph(
        "<i>This document is for internal team review. Please mark up changes and share feedback "
        "before we implement these flows in the ERP system.</i>",
        ParagraphStyle('footer', parent=body, fontSize=9, textColor=GRAY, alignment=TA_CENTER)))

    # Build
    doc.build(story)
    print(f"PDF created: {OUTPUT}")


if __name__ == "__main__":
    build_pdf()
