#!/bin/bash
# E2E test: DDGS Sale — SO → Dispatch → Weighbridge → Invoice → Payment
# Tests the complete document cycle for an ethanol plant DDGS sale

BASE="http://localhost:5000/api"
set -e

echo "══════════════════════════════════════════════"
echo "  DDGS Sale E2E Test — Ethanol Plant ERP"
echo "══════════════════════════════════════════════"

# 1. Login
echo -e "\n[1] Login..."
TOKEN=$(curl -sf "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"admin@mspil.com","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AUTH="Authorization: Bearer $TOKEN"
echo "   ✓ Logged in"

# 2. Get/create customer
echo -e "\n[2] Get or create buyer..."
CUST_ID=$(curl -sf "$BASE/customers" -H "$AUTH" | python3 -c "
import sys,json
data = json.load(sys.stdin)
custs = data.get('customers', data) if isinstance(data, dict) else data
if custs:
    print(custs[0]['id'])
else:
    print('')
")
if [ -z "$CUST_ID" ]; then
  CUST_ID=$(curl -sf "$BASE/customers" -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"name":"Raj Feeds Pvt Ltd","shortName":"RAJFEEDS","phone":"9876543210","gstin":"23AABCR1234A1Z5","address":"Bhopal MP"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "   ✓ Created buyer: $CUST_ID"
else
  echo "   ✓ Using existing buyer: $CUST_ID"
fi

# 3. Create Sale Order (300 MT DDGS @ 18000)
echo -e "\n[3] Create Sale Order (300 MT DDGS @ ₹18,000)..."
SO=$(curl -sf "$BASE/sales-orders" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"customerId\": \"$CUST_ID\",
  \"orderDate\": \"$(date +%Y-%m-%d)\",
  \"deliveryDate\": \"$(date -d '+7 days' +%Y-%m-%d 2>/dev/null || date -v+7d +%Y-%m-%d)\",
  \"paymentTerms\": \"NET15\",
  \"logisticsBy\": \"BUYER\",
  \"lineItems\": [{\"productName\":\"DDGS\",\"quantity\":300,\"unit\":\"MT\",\"rate\":18000,\"gstPercent\":5}]
}")
SO_ID=$(echo "$SO" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
SO_NO=$(echo "$SO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('orderNo','?'))")
SO_TOTAL=$(echo "$SO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('grandTotal',0))")
echo "   ✓ SO #$SO_NO created | Total: ₹$SO_TOTAL | Status: DRAFT"

# 4. Confirm SO
echo -e "\n[4] Confirm Sale Order..."
curl -sf "$BASE/sales-orders/$SO_ID/status" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"CONFIRMED"}' > /dev/null
echo "   ✓ SO #$SO_NO → CONFIRMED"

# 5. Create Dispatch Request (auto in real app, manual here for test)
echo -e "\n[5] Send to Dispatch (logistics)..."
DR=$(curl -sf "$BASE/dispatch-requests" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"orderId\": \"$SO_ID\",
  \"productName\": \"DDGS\",
  \"quantity\": 300,
  \"unit\": \"MT\",
  \"logisticsBy\": \"BUYER\"
}")
DR_ID=$(echo "$DR" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
DR_NO=$(echo "$DR" | python3 -c "import sys,json; print(json.load(sys.stdin).get('drNo','?'))")
DR_STATUS=$(echo "$DR" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))")
echo "   ✓ DR #$DR_NO created | Status: $DR_STATUS"

# 6. Create Shipment (truck arrives at gate)
echo -e "\n[6] Truck arrives — Gate In (MP09KA1234)..."
SHIP=$(curl -sf "$BASE/shipments" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"dispatchRequestId\": \"$DR_ID\",
  \"vehicleNo\": \"MP09KA1234\",
  \"driverName\": \"Ramesh Kumar\",
  \"driverMobile\": \"9988776655\",
  \"transporterName\": \"Shri Transport\",
  \"productName\": \"DDGS\",
  \"customerName\": \"Raj Feeds\",
  \"gateInTime\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
}")
SHIP_ID=$(echo "$SHIP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   ✓ Shipment created | Status: GATE_IN"

# 7. Weighbridge — Tare Weight (empty truck)
echo -e "\n[7] Weighbridge — Tare Weight: 12,500 kg..."
curl -sf "$BASE/shipments/$SHIP_ID/weighbridge" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"tare","weightTare":12500}' > /dev/null
echo "   ✓ Tare: 12,500 kg"

# 8. Loading DDGS
echo -e "\n[8] Loading DDGS onto truck..."
curl -sf "$BASE/shipments/$SHIP_ID/status" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"LOADING"}' > /dev/null
echo "   ✓ Status: LOADING"

# 9. Weighbridge — Gross Weight (loaded truck)
echo -e "\n[9] Weighbridge — Gross Weight: 37,800 kg..."
WEIGH=$(curl -sf "$BASE/shipments/$SHIP_ID/weighbridge" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"gross","weightGross":37800}')
NET=$(echo "$WEIGH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('weightNet',0))")
echo "   ✓ Gross: 37,800 kg | Net: $NET kg ($(python3 -c "print($NET/1000)") MT)"

# 10. Release truck (challan + e-way bill)
echo -e "\n[10] Release truck with documents..."
curl -sf "$BASE/shipments/$SHIP_ID/status" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"RELEASED","challanNo":"CH-2026-001","ewayBill":"EWB1234567890","gatePassNo":"GP-001"}' > /dev/null
echo "   ✓ Status: RELEASED | Challan: CH-2026-001 | E-way: EWB1234567890"

# 11. Truck exits
echo -e "\n[11] Truck exits factory..."
curl -sf "$BASE/shipments/$SHIP_ID/status" -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"EXITED"}' > /dev/null
echo "   ✓ Status: EXITED"

# 12. Create Invoice (based on actual weight)
echo -e "\n[12] Generate Invoice (based on weighbridge net)..."
NET_TONS=$(python3 -c "print($NET/1000)")
RATE=18000
GST_PCT=5
AMOUNT=$(python3 -c "print(round($NET_TONS * $RATE, 2))")
GST_AMT=$(python3 -c "print(round($AMOUNT * $GST_PCT / 100, 2))")
TOTAL=$(python3 -c "print(round($AMOUNT + $GST_AMT, 2))")

INV=$(curl -sf "$BASE/invoices" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"customerId\": \"$CUST_ID\",
  \"orderId\": \"$SO_ID\",
  \"shipmentId\": \"$SHIP_ID\",
  \"productName\": \"DDGS\",
  \"quantity\": $NET_TONS,
  \"unit\": \"MT\",
  \"rate\": $RATE,
  \"gstPercent\": $GST_PCT,
  \"freightCharge\": 0,
  \"invoiceDate\": \"$(date +%Y-%m-%d)\",
  \"challanNo\": \"CH-2026-001\",
  \"ewayBill\": \"EWB1234567890\"
}")
INV_ID=$(echo "$INV" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
INV_NO=$(echo "$INV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('invoiceNo','?'))")
INV_TOTAL=$(echo "$INV" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalAmount',0))")
echo "   ✓ Invoice #$INV_NO | $NET_TONS MT × ₹$RATE = ₹$AMOUNT + GST ₹$GST_AMT = ₹$INV_TOTAL"

# 13. Record Payment
echo -e "\n[13] Record Payment..."
PAY=$(curl -sf "$BASE/payments" -H "$AUTH" -H "Content-Type: application/json" -d "{
  \"invoiceId\": \"$INV_ID\",
  \"customerId\": \"$CUST_ID\",
  \"amount\": $INV_TOTAL,
  \"paymentDate\": \"$(date +%Y-%m-%d)\",
  \"paymentMode\": \"NEFT\",
  \"reference\": \"UTR123456789\"
}")
PAY_ID=$(echo "$PAY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "   ✓ Payment recorded: ₹$INV_TOTAL via NEFT (UTR123456789)"

# 14. Verify final states
echo -e "\n[14] Verify final states..."
FINAL_SO=$(curl -sf "$BASE/sales-orders/$SO_ID" -H "$AUTH")
FINAL_STATUS=$(echo "$FINAL_SO" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
FINAL_INV=$(curl -sf "$BASE/invoices/$INV_ID" -H "$AUTH")
INV_STATUS=$(echo "$FINAL_INV" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

echo "   SO #$SO_NO: $FINAL_STATUS"
echo "   Invoice #$INV_NO: $INV_STATUS"

echo ""
echo "══════════════════════════════════════════════"
echo "  DOCUMENT CYCLE COMPLETE"
echo "══════════════════════════════════════════════"
echo ""
echo "  Sale Order #$SO_NO"
echo "    ↓ (auto-confirmed + sent to dispatch)"
echo "  Dispatch #$DR_NO  [$DR_STATUS]"
echo "    ↓ (truck MP09KA1234 assigned)"
echo "  Weighbridge"
echo "    Tare: 12,500 kg → Load DDGS → Gross: 37,800 kg"
echo "    Net: $NET kg ($NET_TONS MT)"
echo "    ↓ (challan + e-way bill)"
echo "  Invoice #$INV_NO"
echo "    $NET_TONS MT × ₹18,000 + 5% GST = ₹$INV_TOTAL"
echo "    ↓ (NEFT payment)"
echo "  Payment: ₹$INV_TOTAL [$INV_STATUS]"
echo ""
echo "══════════════════════════════════════════════"
