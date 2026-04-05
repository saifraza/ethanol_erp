/**
 * One-time migration: Import historical MASH ethanol dispatch data
 * Source: Book1.xlsx (old Tally data, 153 liftings with invoices already generated)
 *
 * Run: npx ts-node scripts/import-mash-history.ts
 * Or:  node -e "require('./dist/scripts/import-mash-history.js')"
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONTRACT_ID = 'c2a9f488-3017-4448-b4ee-fecaa08e5326';
const CUSTOMER_ID = '123b5835-b693-4b5f-a28d-5bec25177545';
const RATE = 14;
const QTY_BL = 40000;
const QTY_KL = 40;
const GST_PERCENT = 18;
const AMOUNT = QTY_BL * RATE; // 560000
const GST_AMOUNT = Math.round(AMOUNT * GST_PERCENT / 100 * 100) / 100; // 100800
const TOTAL_AMOUNT = Math.round(AMOUNT + GST_AMOUNT); // 660800

// Parsed from Excel — rows 1-153 (all with invoice numbers)
const rows: { date: string; ewb: string; invoiceNo: string; vehicleNo: string; driverName: string; driverPhone: string }[] = [
  { date: '2026-02-28', ewb: 'M-EJW/26020428-0001', invoiceNo: 'MSPIL/ETHANOL/1', vehicleNo: 'KA01AM3278', driverName: 'Sajid Khan', driverPhone: '' },
  { date: '2026-02-28', ewb: 'M-EJW/26020428-0002', invoiceNo: 'MSPIL/ETHANOL/2', vehicleNo: 'KA01AN1051', driverName: 'Samir', driverPhone: '6290205955' },
  { date: '2026-02-28', ewb: 'M-EJW/26020428-0003', invoiceNo: 'MSPIL/ETHANOL/3', vehicleNo: 'KA01AN0766', driverName: 'Tarak Roy', driverPhone: '9123328807' },
  { date: '2026-03-01', ewb: 'M-EJW/26030401-0004', invoiceNo: 'MSPIL/ETHANOL/4', vehicleNo: 'KA01AM3476', driverName: 'Ramathan', driverPhone: '7644066455' },
  { date: '2026-03-01', ewb: 'M-EJW/26030401-0005', invoiceNo: 'MSPIL/ETHANOL/5', vehicleNo: 'KA01AN2800', driverName: 'Firoj Khan', driverPhone: '993163961' },
  { date: '2026-03-01', ewb: 'M-EJW/26030401-0006', invoiceNo: 'MSPIL/ETHANOL/6', vehicleNo: 'KA01AM2829', driverName: 'Selvarethinam', driverPhone: '7077585704' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0007', invoiceNo: 'MSPIL/ETHANOL/7', vehicleNo: 'KA01AN2797', driverName: 'Javed Khan', driverPhone: '7069106995' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0008', invoiceNo: 'MSPIL/ETHANOL/8', vehicleNo: 'KA01AM2961', driverName: 'Kausar Alam', driverPhone: '9122587558' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0009', invoiceNo: 'MSPIL/ETHANOL/9', vehicleNo: 'KA01AN2384', driverName: 'Arman', driverPhone: '8250622956' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0010', invoiceNo: 'MSPIL/ETHANOL/10', vehicleNo: 'KA01AM4678', driverName: 'Moh. Riyaz', driverPhone: '8109455770' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0011', invoiceNo: 'MSPIL/ETHANOL/11', vehicleNo: 'KA01AM2824', driverName: 'Rizwan Khan', driverPhone: '8345809495' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0012', invoiceNo: 'MSPIL/ETHANOL/12', vehicleNo: 'KA01AM2596', driverName: 'Imran', driverPhone: '9113723012' },
  { date: '2026-03-02', ewb: 'M-EJW/26030102-0013', invoiceNo: 'MSPIL/ETHANOL/13', vehicleNo: 'KA01AM2953', driverName: 'Saddab Khan', driverPhone: '8999801744' },
  { date: '2026-03-03', ewb: 'M-EJW/26030103-0014', invoiceNo: 'MSPIL/ETHANOL/14', vehicleNo: 'KA01AM2832', driverName: 'Saji BK', driverPhone: '6369322506' },
  { date: '2026-03-03', ewb: 'M-EJW/26030103-0015', invoiceNo: 'MSPIL/ETHANOL/15', vehicleNo: 'KA01AN0767', driverName: 'Anis Khan', driverPhone: '7489346037' },
  { date: '2026-03-03', ewb: 'M-EJW/26030103-0016', invoiceNo: 'MSPIL/ETHANOL/16', vehicleNo: 'KA01AM4677', driverName: 'Prem Kumar', driverPhone: '9801963668' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0017', invoiceNo: 'MSPIL/ETHANOL/18', vehicleNo: 'KA01AN2383', driverName: 'Pundlik', driverPhone: '9353483835' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0018', invoiceNo: 'MSPIL/ETHANOL/19', vehicleNo: 'KA01AM6760', driverName: 'Bablu Kumar', driverPhone: '6200970091' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0019', invoiceNo: 'MSPIL/ETHANOL/20', vehicleNo: 'KA01AM3474', driverName: 'Salam Basha', driverPhone: '7026920756' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0020', invoiceNo: 'MSPIL/ETHANOL/21', vehicleNo: 'KA01AN1281', driverName: 'Gurucharan Singh', driverPhone: '7635035534' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0021', invoiceNo: 'MSPIL/ETHANOL/22', vehicleNo: 'KA01AN1740', driverName: 'Samsher Singh', driverPhone: '7426876575' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0022', invoiceNo: 'MSPIL/ETHANOL/23', vehicleNo: 'KA01AN2796', driverName: 'Pawan Rai', driverPhone: '9142121873' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0023', invoiceNo: 'MSPIL/ETHANOL/24', vehicleNo: 'KA01AM2613', driverName: 'Chellappa', driverPhone: '6388717838' },
  { date: '2026-03-05', ewb: 'M-EJW/26030105-0024', invoiceNo: 'MSPIL/ETHANOL/25', vehicleNo: 'KA01AM2594', driverName: 'Ajay Singh', driverPhone: '7488528687' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0025', invoiceNo: 'MSPIL/ETHANOL/26', vehicleNo: 'KA01AM4672', driverName: 'Pradeep Kumar', driverPhone: '9947578034' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0026', invoiceNo: 'MSPIL/ETHANOL/27', vehicleNo: 'KA01AM2835', driverName: 'Thangaraj', driverPhone: '9788104204' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0027', invoiceNo: 'MSPIL/ETHANOL/28', vehicleNo: 'KA01AN3940', driverName: 'Palanisamy', driverPhone: '7899453634' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0028', invoiceNo: 'MSPIL/ETHANOL/29', vehicleNo: 'KA01AM3480', driverName: 'Sunder', driverPhone: '' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0029', invoiceNo: 'MSPIL/ETHANOL/30', vehicleNo: 'KA01AN0768', driverName: 'Prasath', driverPhone: '9597281064' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0030', invoiceNo: 'MSPIL/ETHANOL/31', vehicleNo: 'KA01AN3919', driverName: 'Mani', driverPhone: '8438398627' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0031', invoiceNo: 'MSPIL/ETHANOL/32', vehicleNo: 'KA01AM2768', driverName: 'Periyasamy Palani', driverPhone: '6381191915' },
  { date: '2026-03-06', ewb: 'M-EJW/26030106-0032', invoiceNo: 'MSPIL/ETHANOL/33', vehicleNo: 'KA01AM4681', driverName: 'Pandi Arjun', driverPhone: '7538130094' },
  { date: '2026-03-07', ewb: 'M-EJW/26030107-0033', invoiceNo: 'MSPIL/ETHANOL/34', vehicleNo: 'KA01AM2826', driverName: 'Banwari Lal', driverPhone: '9034174221' },
  { date: '2026-03-07', ewb: 'M-EJW/26030107-0034', invoiceNo: 'MSPIL/ETHANOL/35', vehicleNo: 'KA01AM2822', driverName: 'Virupakshi', driverPhone: '6361191189' },
  { date: '2026-03-07', ewb: 'M-EJW/26030107-0035', invoiceNo: 'MSPIL/ETHANOL/36', vehicleNo: 'KA01AN0780', driverName: 'Vasanthan', driverPhone: '8136859018' },
  { date: '2026-03-07', ewb: 'M-EJW/26030107-0036', invoiceNo: 'MSPIL/ETHANOL/37', vehicleNo: 'KA01AM2956', driverName: 'Sohil Khan', driverPhone: '7700015206' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0037', invoiceNo: 'MSPIL/ETHANOL/39', vehicleNo: 'KA01AM3473', driverName: 'Chandrashekhar', driverPhone: '9345178931' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0038', invoiceNo: 'MSPIL/ETHANOL/40', vehicleNo: 'KA01AM4674', driverName: 'LOGANTHEAN', driverPhone: '9486066732' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0039', invoiceNo: 'MSPIL/ETHANOL/41', vehicleNo: 'KA01AM3276', driverName: 'RENGANATHAN', driverPhone: '9566992366' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0040', invoiceNo: 'MSPIL/ETHANOL/42', vehicleNo: 'KA01AM3376', driverName: 'THIPPESWAAMY', driverPhone: '8105415992' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0041', invoiceNo: 'MSPIL/ETHANOL/43', vehicleNo: 'KA01AM2955', driverName: 'Naburaj', driverPhone: '6302359100' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0042', invoiceNo: 'MSPIL/ETHANOL/44', vehicleNo: 'KA01AM4683', driverName: 'Jayprakash', driverPhone: '6382656571' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0043', invoiceNo: 'MSPIL/ETHANOL/45', vehicleNo: 'KA01AM4664', driverName: 'Chinasamy m', driverPhone: '7010833326' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0044', invoiceNo: 'MSPIL/ETHANOL/46', vehicleNo: 'KA01AM4667', driverName: 'Jhondasha', driverPhone: '6379517500' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0045', invoiceNo: 'MSPIL/ETHANOL/47', vehicleNo: 'KA01AM4668', driverName: 'Thamil Selvan M', driverPhone: '8807355395' },
  { date: '2026-03-09', ewb: 'M-EJW/26030209-0046', invoiceNo: 'MSPIL/ETHANOL/48', vehicleNo: 'KA01AN3918', driverName: 'SURENDRAN', driverPhone: '7907101501' },
  { date: '2026-03-10', ewb: 'M-EJW/26030210-0047', invoiceNo: 'MSPIL/ETHANOL/61', vehicleNo: 'KA01AM3265', driverName: 'Thangaeeswaran p', driverPhone: '9976240980' },
  { date: '2026-03-10', ewb: 'M-EJW/26030210-0048', invoiceNo: 'MSPIL/ETHANOL/62', vehicleNo: 'KA01AN0781', driverName: 'K. Muthupandi', driverPhone: '8248668671' },
  { date: '2026-03-11', ewb: 'M-EJW/26030210-0049', invoiceNo: 'MSPIL/ETHANOL/72', vehicleNo: 'KA01AN1744', driverName: 'Dara khan', driverPhone: '9337003475' },
  { date: '2026-03-11', ewb: 'M-EJW/26030210-0050', invoiceNo: 'MSPIL/ETHANOL/73', vehicleNo: 'KA01AN2386', driverName: 'mohammad chand', driverPhone: '6200154630' },
  { date: '2026-03-11', ewb: 'M-EJW/26030210-0051', invoiceNo: 'MSPIL/ETHANOL/74', vehicleNo: 'KA01AM2962', driverName: 'Manish Kumar', driverPhone: '9142734259' },
  { date: '2026-03-13', ewb: 'M-EJW/26030213-0052', invoiceNo: 'MSPIL/ETHANOL/85', vehicleNo: 'KA01AM3273', driverName: 'Neelana gouda m', driverPhone: '9591242281' },
  { date: '2026-03-13', ewb: 'M-EJW/26030213-0053', invoiceNo: 'MSPIL/ETHANOL/86', vehicleNo: 'KA01AN1741', driverName: 'FAZAL SHAIK', driverPhone: '9848853329' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0054', invoiceNo: 'MSPIL/ETH/111', vehicleNo: 'KA01AM4676', driverName: 'Ajay Kumar', driverPhone: '9576997806' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0055', invoiceNo: 'MSPIL/ETH/112', vehicleNo: 'KA01AM3385', driverName: 'Md Sikandar', driverPhone: '6281947913' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0056', invoiceNo: 'MSPIL/ETH/113', vehicleNo: 'KA01AM5560', driverName: 'Imran khan', driverPhone: '9142186629' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0057', invoiceNo: 'MSPIL/ETH/114', vehicleNo: 'KA01AM3476', driverName: 'Rahmat Khan', driverPhone: '7644066455' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0058', invoiceNo: 'MSPIL/ETH/115', vehicleNo: 'KA01AM2599', driverName: 'Ramlingam k', driverPhone: '9962394651' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0059', invoiceNo: 'MSPIL/ETH/116', vehicleNo: 'KA01AN1284', driverName: 'C Ravi', driverPhone: '9944661219' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0060', invoiceNo: 'MSPIL/ETH/117', vehicleNo: 'KA01AN1742', driverName: 'Sohel Ahmed', driverPhone: '915242091' },
  { date: '2026-03-14', ewb: 'M-EJW/26030214-0061', invoiceNo: 'MSPIL/ETH/118', vehicleNo: 'KA01AM4680', driverName: 'Nadeen Akhter', driverPhone: '8081255580' },
  { date: '2026-03-15', ewb: 'M-EJW/26030315-0062', invoiceNo: 'MSPIL/ETH/122', vehicleNo: 'KA01AM3268', driverName: 'Muttanna', driverPhone: '7019919542' },
  { date: '2026-03-15', ewb: 'M-EJW/26030315-0063', invoiceNo: 'MSPIL/ETH/123', vehicleNo: 'KA01AM2765', driverName: 'Satish Kumar', driverPhone: '7019919542' },
  { date: '2026-03-15', ewb: 'M-EJW/26030315-0064', invoiceNo: 'MSPIL/ETH/124', vehicleNo: 'KA01AM2614', driverName: 'P. Karrupiah', driverPhone: '7019919542' },
  { date: '2026-03-16', ewb: 'M-EJW/26030316-0065', invoiceNo: 'MSPIL/ETH/133', vehicleNo: 'KA01AM3380', driverName: 'Balakrishna', driverPhone: '9384781447' },
  { date: '2026-03-16', ewb: 'M-EJW/26030316-0066', invoiceNo: 'MSPIL/ETH/134', vehicleNo: 'KA01AM2831', driverName: 'Gopala krishna', driverPhone: '9092232314' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0067', invoiceNo: 'MSPIL/ETH/139', vehicleNo: 'KA01AN1032', driverName: 'RAVINDRA', driverPhone: '9340104898' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0068', invoiceNo: 'MSPIL/ETH/140', vehicleNo: 'KA01AM4665', driverName: 'BASHEER', driverPhone: '7999699942' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0069', invoiceNo: 'MSPIL/ETH/141', vehicleNo: 'KA01AM3267', driverName: 'SONU', driverPhone: '8160602593' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0070', invoiceNo: 'MSPIL/ETH/142', vehicleNo: 'KA01AN3938', driverName: 'SONURAM', driverPhone: '89520282620' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0071', invoiceNo: 'MSPIL/ETH/143', vehicleNo: 'KA01AM3272', driverName: 'Parayappa', driverPhone: '8951899554' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0072', invoiceNo: 'MSPIL/ETH/144', vehicleNo: 'KA01AM2959', driverName: 'SANDEEP', driverPhone: '9742116358' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0073', invoiceNo: 'MSPIL/ETH/145', vehicleNo: 'KA01AN3940', driverName: 'PALAMISAMI', driverPhone: '7899453634' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0074', invoiceNo: 'MSPIL/ETH/146', vehicleNo: 'KA01AN0780', driverName: 'Vasanthan', driverPhone: '8136859018' },
  { date: '2026-03-17', ewb: 'M-EJW/26030317-0075', invoiceNo: 'MSPIL/ETH/147', vehicleNo: 'KA01AM3371', driverName: 'Rajendra', driverPhone: '7735999631' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0076', invoiceNo: 'MSPIL/ETH/151', vehicleNo: 'KA01AM2763', driverName: 'JAYAYT', driverPhone: '7205916645' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0077', invoiceNo: 'MSPIL/ETH/152', vehicleNo: 'KA01AM2761', driverName: 'Jamejaya Rout', driverPhone: '8249279169' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0078', invoiceNo: 'MSPIL/ETH/153', vehicleNo: 'KA01AM3278', driverName: 'SAZID KHAN', driverPhone: '7632003204' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0079', invoiceNo: 'MSPIL/ETH/154', vehicleNo: 'KA01AN0766', driverName: 'TARAK ROY', driverPhone: '9123328807' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0080', invoiceNo: 'MSPIL/ETH/155', vehicleNo: 'NL01AH0208', driverName: 'Bhagirath Singh', driverPhone: '8585847595' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0081', invoiceNo: 'MSPIL/ETH/156', vehicleNo: 'KA01AM5569', driverName: 'Mo. Irfan Ali', driverPhone: '7523964108' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0082', invoiceNo: 'MSPIL/ETH/157', vehicleNo: 'KA01AM3386', driverName: 'Shami khan', driverPhone: '8979283744' },
  { date: '2026-03-18', ewb: 'M-EJW/26030318-0083', invoiceNo: 'MSPIL/ETH/158', vehicleNo: 'KA01AM5568', driverName: 'Kainat Mansoori', driverPhone: '9454696637' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0084', invoiceNo: 'MSPIL/ETH/159', vehicleNo: 'KA01AM4762', driverName: 'Mohideen Akaram Khan', driverPhone: '9321146584' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0085', invoiceNo: 'MSPIL/ETH/160', vehicleNo: 'KA01AM4663', driverName: 'Akbar Khan', driverPhone: '7497971482' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0086', invoiceNo: 'MSPIL/ETH/161', vehicleNo: 'KA01AM2595', driverName: 'Kasim Khan', driverPhone: '9749916640' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0087', invoiceNo: 'MSPIL/ETH/162', vehicleNo: 'KA01AM2829', driverName: 'Selvarethinam', driverPhone: '7077585704' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0088', invoiceNo: 'MSPIL/ETH/163', vehicleNo: 'KA01AM5561', driverName: 'SANKAR', driverPhone: '8525825223' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0089', invoiceNo: 'MSPIL/ETH/164', vehicleNo: 'KA01AM3378', driverName: 'Yashkumaran', driverPhone: '7010155665' },
  { date: '2026-03-19', ewb: 'M-EJW/26030319-0090', invoiceNo: 'MSPIL/ETH/165', vehicleNo: 'NL01AJ4923', driverName: 'Mukesh Kumar', driverPhone: '9704322582' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0091', invoiceNo: 'MSPIL/ETH/167', vehicleNo: 'KA01AM5565', driverName: 'Mithlesh yadav', driverPhone: '9630368206' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0092', invoiceNo: 'MSPIL/ETH/168', vehicleNo: 'KA01AM2832', driverName: 'SAJI BK', driverPhone: '6369322506' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0093', invoiceNo: 'MSPIL/ETH/169', vehicleNo: 'KA01AM4764', driverName: 'DILIP KUMAR YADAV', driverPhone: '6261372346' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0094', invoiceNo: 'MSPIL/ETH/170', vehicleNo: 'KA01AM3373', driverName: 'BABULAL YADAV', driverPhone: '9516182550' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0095', invoiceNo: 'MSPIL/ETH/171', vehicleNo: 'KA01AM3263', driverName: 'SUKUMAR YADAV', driverPhone: '6355626370' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0096', invoiceNo: 'MSPIL/ETH/172', vehicleNo: 'KA01AM3480', driverName: 'Sundar', driverPhone: '9655518672' },
  { date: '2026-03-20', ewb: 'M-EJW/26030320-0097', invoiceNo: 'MSPIL/ETH/173', vehicleNo: 'KA01AM4684', driverName: 'HASIBUL SK', driverPhone: '8391885833' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-0098', invoiceNo: 'MSPIL/ETH/191', vehicleNo: 'KA01AN1280', driverName: 'Bhupendra Yadav', driverPhone: '8815057793' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-0099', invoiceNo: 'MSPIL/ETH/192', vehicleNo: 'KA01AM3936', driverName: 'AWDESH YADAV', driverPhone: '9120669118' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-00100', invoiceNo: 'MSPIL/ETH/193', vehicleNo: 'KA01AM3270', driverName: 'Prem Sagar Prajapati', driverPhone: '8009456909' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-00101', invoiceNo: 'MSPIL/ETH/194', vehicleNo: 'KA01AM2767', driverName: 'Deva Santosh Raj', driverPhone: '8124544951' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-00102', invoiceNo: 'MSPIL/ETH/195', vehicleNo: 'KA01AM3269', driverName: 'DILEEP VC', driverPhone: '9761773343' },
  { date: '2026-03-21', ewb: 'M-EJW/26030321-00103', invoiceNo: 'MSPIL/ETH/196', vehicleNo: 'KA01AM2822', driverName: 'VIRUPAKSHI KUMBAR', driverPhone: '6361191189' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00104', invoiceNo: 'MSPIL/ETH/197', vehicleNo: 'KA01AM2826', driverName: 'BANWARI LAL', driverPhone: '9034174221' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00105', invoiceNo: 'MSPIL/ETH/198', vehicleNo: 'KA01AM1282', driverName: 'basappu', driverPhone: '9901941384' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00106', invoiceNo: 'MSPIL/ETH/199', vehicleNo: 'KA01AN2381', driverName: 'Manjunatha', driverPhone: '6364064636' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00107', invoiceNo: 'MSPIL/ETH/200', vehicleNo: 'KA01AM2612', driverName: 'Mallappa Halaor', driverPhone: '8139923139' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00108', invoiceNo: 'MSPIL/ETH/201', vehicleNo: 'KA01AM5594', driverName: 'Murukeshpandi k', driverPhone: '9943665610' },
  { date: '2026-03-22', ewb: 'M-EJW/26030422-00109', invoiceNo: 'MSPIL/ETH/202', vehicleNo: 'KA01AM5567', driverName: 'Vignesh Waran', driverPhone: '9500808533' },
  { date: '2026-03-23', ewb: 'M-EJW/26030423-00110', invoiceNo: 'MSPIL/ETH/219', vehicleNo: 'KA01AM2956', driverName: 'Mohd Sohel Khan', driverPhone: '7700015206' },
  { date: '2026-03-23', ewb: 'M-EJW/26030423-00111', invoiceNo: 'MSPIL/ETH/220', vehicleNo: 'KA01AM4662', driverName: 'Hanuman singh', driverPhone: '9119867494' },
  { date: '2026-03-23', ewb: 'M-EJW/26030423-00112', invoiceNo: 'MSPIL/ETH/221', vehicleNo: 'KA01AM4678', driverName: 'MO. Riyaj', driverPhone: '8109455770' },
  { date: '2026-03-23', ewb: 'M-EJW/26030423-00113', invoiceNo: 'MSPIL/ETH/222', vehicleNo: 'KA01AN0767', driverName: 'Anis khan', driverPhone: '7489346037' },
  { date: '2026-03-24', ewb: 'M-EJW/26030424-00114', invoiceNo: 'MSPIL/ETH/228', vehicleNo: 'KA01AM3265', driverName: 'THANGASWARAM P', driverPhone: '9976240980' },
  { date: '2026-03-24', ewb: 'M-EJW/26030424-00115', invoiceNo: 'MSPIL/ETH/229', vehicleNo: 'KA01AM2838', driverName: 'Jagdish p', driverPhone: '9632533691' },
  { date: '2026-03-24', ewb: 'M-EJW/26030424-00116', invoiceNo: 'MSPIL/ETH/230', vehicleNo: 'KA01AM4668', driverName: 'Thamil selvan m', driverPhone: '8807355395' },
  { date: '2026-03-25', ewb: 'M-EJW/26030425-00117', invoiceNo: 'MSPIL/ETH/231', vehicleNo: 'KA01AM3372', driverName: 'ANIL KUMAR YADAV', driverPhone: '9771973636' },
  { date: '2026-03-25', ewb: 'M-EJW/26030425-00118', invoiceNo: 'MSPIL/ETH/232', vehicleNo: 'KA01AM2954', driverName: 'PUNDALIKAPPA', driverPhone: '8618814088' },
  { date: '2026-03-25', ewb: 'M-EJW/26030425-00119', invoiceNo: 'MSPIL/ETH/233', vehicleNo: 'KA01AM2830', driverName: 'Nandeesha', driverPhone: '6362764712' },
  { date: '2026-03-26', ewb: 'M-EJW/26030426-00120', invoiceNo: 'MSPIL/ETH/234', vehicleNo: 'KA01AM2836', driverName: 'Jitendra Singh', driverPhone: '7045212234' },
  { date: '2026-03-26', ewb: 'M-EJW/26030426-00121', invoiceNo: 'MSPIL/ETH/235', vehicleNo: 'KA01AM2593', driverName: 'Salim Tirkey', driverPhone: '8456838291' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00122', invoiceNo: 'MSPIL/ETH/237', vehicleNo: 'KA01AN1281', driverName: 'Gurucharan singh', driverPhone: '7635035534' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00123', invoiceNo: 'MSPIL/ETH/238', vehicleNo: 'KA01AN1742', driverName: 'Sohel Ahmed', driverPhone: '6388167765' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00124', invoiceNo: 'MSPIL/ETH/239', vehicleNo: 'KA01AN2795', driverName: 'MD RAJA KHAN', driverPhone: '7488802268' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00125', invoiceNo: 'MSPIL/ETH/240', vehicleNo: 'KA01AM4666', driverName: 'Akhilesh Yadav', driverPhone: '920037082' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00126', invoiceNo: 'MSPIL/ETH/241', vehicleNo: 'KA01AM4680', driverName: 'Nadeem Akhter', driverPhone: '8081255580' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00127', invoiceNo: 'MSPIL/ETH/242', vehicleNo: 'KA01AM3475', driverName: 'MD AFZAL KHAN', driverPhone: '9931449712' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00128', invoiceNo: 'MSPIL/ETH/243', vehicleNo: 'KA01AN3917', driverName: 'SAHAWAJ', driverPhone: '7738417286' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00129', invoiceNo: 'MSPIL/ETH/244', vehicleNo: 'KA01AN2797', driverName: 'JAWAD KHAN', driverPhone: '7069106995' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00130', invoiceNo: 'MSPIL/ETH/245', vehicleNo: 'KA01AM4677', driverName: 'PREM KR MAHATO', driverPhone: '9801963668' },
  { date: '2026-03-27', ewb: 'M-EJW/26030427-00131', invoiceNo: 'MSPIL/ETH/246', vehicleNo: 'KA01AM2761', driverName: 'Jamejaya Rout', driverPhone: '8249279169' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00132', invoiceNo: 'MSPIL/ETH/248', vehicleNo: 'KA01AN1741', driverName: 'FAZUL SHAIK', driverPhone: '9848853329' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00133', invoiceNo: 'MSPIL/ETH/249', vehicleNo: 'KA01AM2831', driverName: 'GOPAL KRISHNAN K', driverPhone: '9092232314' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00134', invoiceNo: 'MSPIL/ETH/250', vehicleNo: 'KA01AM2763', driverName: 'JAYANTA KUMAR ROY', driverPhone: '7205916645' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00135', invoiceNo: 'MSPIL/ETH/251', vehicleNo: 'KA01AN0768', driverName: 'PRASATH S', driverPhone: '9597481064' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00136', invoiceNo: 'MSPIL/ETH/254', vehicleNo: 'KA01AN3919', driverName: 'MASILARONI S', driverPhone: '8438398627' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00137', invoiceNo: 'MSPIL/ETH/255', vehicleNo: 'KA01AM3473', driverName: 'R. CHANDRA SEKHAR', driverPhone: '9345178931' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00138', invoiceNo: 'MSPIL/ETH/256', vehicleNo: 'KA01AM2765', driverName: 'Satish Kumar G', driverPhone: '9994313698' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00139', invoiceNo: 'MSPIL/ETH/257', vehicleNo: 'KA01AM2614', driverName: 'P KARUPPIAH', driverPhone: '9585174621' },
  { date: '2026-03-28', ewb: 'M-EJW/26030428-00140', invoiceNo: 'MSPIL/ETH/258', vehicleNo: 'KA01AM2768', driverName: 'Periyasamy Palani', driverPhone: '6381191915' },
  { date: '2026-03-29', ewb: 'M-EJW/26030429-00141', invoiceNo: 'MSPIL/ETH/266', vehicleNo: 'KA01AM4763', driverName: 'pandiyanathan', driverPhone: '9791624504' },
  { date: '2026-03-29', ewb: 'M-EJW/26030429-00142', invoiceNo: 'MSPIL/ETH/267', vehicleNo: 'KA01AM4675', driverName: 'saravanan k', driverPhone: '6369670330' },
  { date: '2026-03-30', ewb: 'M-EJW/26030430-00143', invoiceNo: 'MSPIL/ETH/268', vehicleNo: 'KA01AN0771', driverName: 'SHYAM LAL YADAV', driverPhone: '6387914506' },
  { date: '2026-03-30', ewb: 'M-EJW/26030430-00144', invoiceNo: 'MSPIL/ETH/269', vehicleNo: 'KA01AM3477', driverName: 'SUNIL KUMAR SINGH YADAV', driverPhone: '8573827700' },
  { date: '2026-03-30', ewb: 'M-EJW/26040102-00145', invoiceNo: 'MSPIL/ETH/005', vehicleNo: 'KA01AM4764', driverName: 'DILIP KUMAR YADAV', driverPhone: '6261372346' },
  { date: '2026-04-02', ewb: 'M-EJW/26040102-00146', invoiceNo: 'MSPIL/ETH/006', vehicleNo: 'KA01AM3262', driverName: 'ABUL SATTAR', driverPhone: '6281442431' },
  { date: '2026-04-02', ewb: 'M-EJW/26040102-00147', invoiceNo: 'MSPIL/ETH/007', vehicleNo: 'KA01AM5565', driverName: 'MITHESH YADAV JI', driverPhone: '9630268206' },
  { date: '2026-04-02', ewb: 'M-EJW/26040102-00148', invoiceNo: 'MSPIL/ETH/008', vehicleNo: 'KA01AN2387', driverName: 'KRISHNA CHANDRA SAHU', driverPhone: '7898916174' },
  { date: '2026-04-02', ewb: 'M-EJW/26040102-00149', invoiceNo: 'MSPIL/ETH/009', vehicleNo: 'KA01AN1280', driverName: 'BHUPENDRA YADAV', driverPhone: '8815057793' },
  { date: '2026-04-02', ewb: 'M-EJW/26040102-00150', invoiceNo: 'MSPIL/ETH/010', vehicleNo: 'KA01AM3373', driverName: 'BABULAL YADAV', driverPhone: '9516182550' },
  { date: '2026-04-03', ewb: 'M-EJW/26040103-00151', invoiceNo: 'MSPIL/ETH/011', vehicleNo: 'KA01AM2767', driverName: 'DEVA SANTOSH RAJV', driverPhone: '8124544951' },
  { date: '2026-04-03', ewb: 'M-EJW/26040103-00152', invoiceNo: 'MSPIL/ETH/012', vehicleNo: 'KA01AM2764', driverName: 'PAUL DURAI T', driverPhone: '9594083159' },
  { date: '2026-04-03', ewb: 'M-EJW/26040103-00153', invoiceNo: 'MSPIL/ETH/013', vehicleNo: 'KA01AM5561', driverName: 'SANKAR V', driverPhone: '852582523' },
];

async function main() {
  // Verify contract exists
  const contract = await prisma.ethanolContract.findUnique({ where: { id: CONTRACT_ID } });
  if (!contract) throw new Error('Contract not found');

  // Check existing liftings to avoid duplicates
  const existing = await prisma.ethanolLifting.findMany({
    where: { contractId: CONTRACT_ID },
    select: { vehicleNo: true, liftingDate: true, invoiceNo: true },
  });
  const existingKeys = new Set(existing.map(e => `${e.vehicleNo}-${e.liftingDate.toISOString().slice(0, 10)}`));

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const key = `${row.vehicleNo.replace(/\s/g, '')}-${row.date}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    // Create invoice first
    const invoice = await prisma.invoice.create({
      data: {
        customerId: CUSTOMER_ID,
        invoiceDate: new Date(row.date),
        productName: 'Job Work Charges for Ethanol Production',
        quantity: QTY_BL,
        unit: 'BL',
        rate: RATE,
        amount: AMOUNT,
        gstPercent: GST_PERCENT,
        gstAmount: GST_AMOUNT,
        supplyType: 'INTER_STATE',
        placeOfSupply: 'Odisha',
        cgstPercent: 0,
        cgstAmount: 0,
        sgstPercent: 0,
        sgstAmount: 0,
        igstPercent: GST_PERCENT,
        igstAmount: GST_AMOUNT,
        freightCharge: 0,
        totalAmount: TOTAL_AMOUNT,
        paidAmount: TOTAL_AMOUNT, // historical — already paid
        balanceAmount: 0,
        status: 'PAID',
        irnStatus: 'GENERATED',
        irnDate: new Date(row.date),
        ewbStatus: 'GENERATED',
        userId: 'system',
      },
    });

    // Create lifting linked to invoice
    await prisma.ethanolLifting.create({
      data: {
        contractId: CONTRACT_ID,
        liftingDate: new Date(row.date),
        vehicleNo: row.vehicleNo.replace(/\s/g, ''),
        driverName: row.driverName,
        driverPhone: row.driverPhone,
        destination: 'Odisha',
        quantityBL: QTY_BL,
        quantityKL: QTY_KL,
        rate: RATE,
        amount: AMOUNT,
        status: 'DELIVERED',
        deliveredQtyKL: QTY_KL,
        invoiceId: invoice.id,
        invoiceNo: row.invoiceNo,
      },
    });

    imported++;
  }

  // Update contract totalSuppliedKL
  const allLiftings = await prisma.ethanolLifting.findMany({
    where: { contractId: CONTRACT_ID },
    select: { quantityKL: true },
  });
  const totalKL = allLiftings.reduce((s, l) => s + l.quantityKL, 0);
  await prisma.ethanolContract.update({
    where: { id: CONTRACT_ID },
    data: { totalSuppliedKL: totalKL },
  });

  console.log(`Done. Imported: ${imported}, Skipped (duplicate): ${skipped}, Total liftings: ${allLiftings.length}, Total supplied: ${totalKL} KL`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
