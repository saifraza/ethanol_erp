import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Raw data from Excel
const employees = [
  { sno: 1, name: "Anil K Vanjani", ctc: 500000, department: "Strategy & Business Development", designation: "Chief Strategy & Business Officer", fatherName: "Narayan Vanjani", joiningDate: "2025-12-01", email: "vanjanianil@gmail.com", phone: "9810085777", emergencyNo: "9810429689", bloodGroup: "B+" },
  { sno: 2, name: "Awadh N. Yadav", ctc: 150000, department: "General Management", designation: "General Manager", fatherName: "Virendra yadav", joiningDate: "2024-06-15", email: "yadav.an12@gmail.com", phone: "9519573882", emergencyNo: "", bloodGroup: "" },
  { sno: 3, name: "Shamsuddin Khan", ctc: 141666, department: "Operation", designation: "Operation Head", fatherName: "Rafiuddin khan", joiningDate: "2026-04-06", email: "sk.abd@hotmail.com", phone: "8919149576", emergencyNo: "8919149576", bloodGroup: "A+" },
  { sno: 4, name: "Nitin Sharma", ctc: 50000, department: "Procurement", designation: "General Manager", fatherName: "Vinod Sharma", joiningDate: "2025-11-03", email: "god'sfan61@gmail.com", phone: "6261372346", emergencyNo: "9479712346", bloodGroup: "A+" },
  { sno: 5, name: "Ram Bhawan Sahu", ctc: 56000, department: "Mechanical", designation: "HOD", fatherName: "Ram Achal Sahu", joiningDate: "2023-10-01", email: "rajusahu6607@gmail.com", phone: "9503068520", emergencyNo: "8839882097", bloodGroup: "" },
  { sno: 6, name: "Dhananjay Tiwari", ctc: 40000, department: "Quality Assurance", designation: "Manager", fatherName: "Ram Lakhan Tiwari", joiningDate: "2025-12-02", email: "dhananjay_jay81@yahoo.co.in", phone: "8962019211", emergencyNo: "8319992429", bloodGroup: "B+" },
  { sno: 7, name: "Tarun Sahu", ctc: 38000, department: "Despatch & Loading", designation: "Incharge", fatherName: "Thunnoo Sahu", joiningDate: "2025-12-16", email: "tarun.sahu1866@gmail.com", phone: "9340353482", emergencyNo: "9165154771", bloodGroup: "B+" },
  { sno: 8, name: "Keshav Prasad Soni", ctc: 20000, department: "Despatch & Loading", designation: "Operator", fatherName: "Kashi Ram Soni", joiningDate: "2026-01-17", email: "sonikeshav152@gmail.com", phone: "6265657882", emergencyNo: "9753603054", bloodGroup: "" },
  { sno: 9, name: "Amar Jeet", ctc: 20000, department: "Despatch & Loading", designation: "Operator", fatherName: "Vinay Kumar", joiningDate: "2026-03-09", email: "ap6306753@gmail.com", phone: "7067852759", emergencyNo: "9981860704", bloodGroup: "A+" },
  { sno: 10, name: "Vijay Mishra", ctc: 55000, department: "Production", designation: "Shift Incharge", fatherName: "", joiningDate: "2025-06-07", email: "vijaymishrasln9@gmail.com", phone: "8798884458", emergencyNo: "7838836273", bloodGroup: "" },
  { sno: 11, name: "Ajai Kumar", ctc: 60000, department: "Production", designation: "Shift Incharge", fatherName: "Baldeo Prasad", joiningDate: "2025-12-06", email: "kumarajai2009@gmail.com", phone: "8400185276", emergencyNo: "9369271556", bloodGroup: "AB+" },
  { sno: 12, name: "Deepak Katiyar", ctc: 52000, department: "Production", designation: "Shift Incharge", fatherName: "Raj Narayan Katiyar", joiningDate: "2026-01-18", email: "deepakatiyar7017@gmail.com", phone: "8429946982", emergencyNo: "9956148434", bloodGroup: "AB+" },
  { sno: 13, name: "Sikandar Yadav", ctc: 60000, department: "Distillation", designation: "Plant Incharge", fatherName: "Babu Lal yadav", joiningDate: "2025-09-04", email: "reply2sikndar@gmail.com", phone: "8789478166", emergencyNo: "8299155521", bloodGroup: "B+" },
  { sno: 14, name: "Abhisek Mishra", ctc: 15000, department: "Distillation", designation: "Operator", fatherName: "Vijay kumar mishra", joiningDate: "2025-12-11", email: "mishraabhishek60855@gmail.com", phone: "9452615379", emergencyNo: "7800057217", bloodGroup: "" },
  { sno: 15, name: "Shashi Kant Yadav", ctc: 60000, department: "Distillation", designation: "Plant Incharge", fatherName: "Amarnath Yadav", joiningDate: "2025-11-07", email: "yadavshi790@gmail.com", phone: "8097515280", emergencyNo: "8542032737", bloodGroup: "B+" },
  { sno: 16, name: "Abhisek Kushwaha", ctc: 27000, department: "Distillation", designation: "Operator", fatherName: "Chandrehwar Bagat", joiningDate: "2025-11-18", email: "abhishekmaurya6364@gmail.com", phone: "8651207086", emergencyNo: "8804439773", bloodGroup: "AB+" },
  { sno: 17, name: "Raghavendra Yadav", ctc: 53000, department: "Distillation", designation: "Plant Incharge", fatherName: "Shri Bhai Lal yadav", joiningDate: "2025-10-13", email: "yadavraghavendra.123@gmail.com", phone: "9054659581", emergencyNo: "6394606178", bloodGroup: "O+" },
  { sno: 18, name: "Prince Gangyan", ctc: 38000, department: "Distillation", designation: "Operator-MEE", fatherName: "Sohanlal Gangyan", joiningDate: "2025-11-08", email: "princegangyan93@gmail.com", phone: "9756093498", emergencyNo: "9690856721", bloodGroup: "B+" },
  { sno: 19, name: "Vinay Ku. Yadav", ctc: 40000, department: "Fermenter", designation: "Operator", fatherName: "Shee Goukul prasad yadav", joiningDate: "2025-11-14", email: "vinayyadavv404@gmail.com", phone: "9721290924", emergencyNo: "9721290927", bloodGroup: "" },
  { sno: 20, name: "Abhay Yadav", ctc: 40000, department: "Fermenter", designation: "Operator", fatherName: "Lal Bhadur Yadav", joiningDate: "2025-12-22", email: "abhay050905@gmail.com", phone: "8858019917", emergencyNo: "9807230604", bloodGroup: "AB+" },
  { sno: 21, name: "Ravindra Yadav", ctc: 40000, department: "Fermenter", designation: "Operator", fatherName: "Paramhans Yadav", joiningDate: "2026-04-01", email: "ravindrayadav123@gmail.com", phone: "7565085929", emergencyNo: "8795486060", bloodGroup: "" },
  { sno: 22, name: "Ankit Yadav", ctc: 15000, department: "Fermenter", designation: "Assistant Operator", fatherName: "Balram Yadav", joiningDate: "2026-01-18", email: "ankityadav559911@gmail.com", phone: "9616252310", emergencyNo: "9214854665", bloodGroup: "" },
  { sno: 23, name: "Pradeep Kumar Yadav", ctc: 15000, department: "Fermenter", designation: "Assistant Operator", fatherName: "Shree Ram Nakshtra yadav", joiningDate: "2026-01-20", email: "py65375@gmail.com", phone: "7007330369", emergencyNo: "8922876878", bloodGroup: "O+" },
  { sno: 24, name: "Vijay Kumar Yadav", ctc: 17000, department: "Fermenter", designation: "Assistant Operator", fatherName: "Ram Bhaghat Yadav", joiningDate: "2025-12-07", email: "vijayyadav83085@gmail.com", phone: "8303576788", emergencyNo: "9721290924", bloodGroup: "" },
  { sno: 25, name: "Amit Yadav", ctc: 40000, department: "Liquefaction", designation: "Operator", fatherName: "Ramesh Babu", joiningDate: "2025-11-08", email: "amit1010g@gmail.com", phone: "8604286537", emergencyNo: "9120589072", bloodGroup: "O+" },
  { sno: 26, name: "Danesh Kumar Verma", ctc: 40000, department: "Liquefaction", designation: "Operator", fatherName: "Raj Kishore Verma", joiningDate: "2025-02-22", email: "dkbrajverma@gmail.com", phone: "7800174466", emergencyNo: "9915316945", bloodGroup: "B+" },
  { sno: 27, name: "Abhisek Pandey", ctc: 37000, department: "Liquefaction", designation: "Operator", fatherName: "Shirish pandey", joiningDate: "2026-01-05", email: "abhishekpandey59224@gmail.com", phone: "9794401421", emergencyNo: "7068100419", bloodGroup: "O+" },
  { sno: 28, name: "Prashant Babu", ctc: 15000, department: "Liquefaction", designation: "Assistant Operator", fatherName: "Anant Ram", joiningDate: "2025-12-26", email: "prashantgautom5451@gmail.com", phone: "6392382585", emergencyNo: "7985397537", bloodGroup: "" },
  { sno: 29, name: "Suraj Jat", ctc: 12000, department: "Liquefaction", designation: "Assistant Operator", fatherName: "Anil Jat", joiningDate: "2026-01-25", email: "sjat91482@gmail.com", phone: "9131800851", emergencyNo: "6232988768", bloodGroup: "AB+" },
  { sno: 30, name: "Praveen Ku. Sharma", ctc: 15000, department: "Liquefaction", designation: "Assistant Operator", fatherName: "Shiv Ram Sharma", joiningDate: "2026-02-02", email: "ps8099084@gmail.com", phone: "9555406457", emergencyNo: "8429295736", bloodGroup: "AB+" },
  { sno: 31, name: "Chanderbhan Singh", ctc: 42000, department: "Liquefaction", designation: "Operator", fatherName: "Babunnand Singh", joiningDate: "2026-04-01", email: "chanderbhans879@gmail.com", phone: "7542006303", emergencyNo: "9771108292", bloodGroup: "B+" },
  { sno: 32, name: "Ajay Kumar Yadav", ctc: 48000, department: "Milling", designation: "Incharge", fatherName: "Lal Singh", joiningDate: "2025-11-17", email: "ajayyadav798709@gmail.com", phone: "7987098026", emergencyNo: "9926019562", bloodGroup: "B+" },
  { sno: 33, name: "Satish Kumar", ctc: 18000, department: "Grain", designation: "Operator", fatherName: "Somnath Singh", joiningDate: "2026-01-10", email: "ahirwarsateesh683@gmail.com", phone: "7489190347", emergencyNo: "8305650893", bloodGroup: "" },
  { sno: 34, name: "Preetam Kumar Yadav", ctc: 20000, department: "Grain", designation: "Operator", fatherName: "Avdhav Narayan yadav", joiningDate: "2025-10-19", email: "", phone: "7860679055", emergencyNo: "9054659581", bloodGroup: "" },
  { sno: 35, name: "Arif Ali", ctc: 12000, department: "Grain", designation: "Helper", fatherName: "Syed Gazanfar Ali", joiningDate: "2025-10-13", email: "syedarifali545@gmail.com", phone: "8815156744", emergencyNo: "", bloodGroup: "B+" },
  { sno: 36, name: "Karan Singh Thakur", ctc: 10000, department: "Grain", designation: "Helper", fatherName: "Kamlesh Thakur", joiningDate: "2026-03-21", email: "karansinghmax7@gmail.com", phone: "7697919892", emergencyNo: "620530470", bloodGroup: "" },
  { sno: 37, name: "Rohit Singh", ctc: 35000, department: "Milling", designation: "Operator", fatherName: "Vinod Singh", joiningDate: "2025-12-15", email: "rohitkrsss07@gmail.com", phone: "7763980607", emergencyNo: "7739548801", bloodGroup: "B+" },
  { sno: 38, name: "Shivam Pal", ctc: 35000, department: "Milling", designation: "Operator", fatherName: "Raj Bahadur", joiningDate: "2026-01-30", email: "shivampaal232@gmail.com", phone: "9956091390", emergencyNo: "9651501177", bloodGroup: "" },
  { sno: 39, name: "Kundan Kumar", ctc: 15000, department: "Milling", designation: "Assistant Operator", fatherName: "Pirbhu Pirshad", joiningDate: "2026-01-19", email: "kundankumar916283@gmail.com", phone: "8404857729", emergencyNo: "9162839774", bloodGroup: "" },
  { sno: 40, name: "Gendalal Choudhary", ctc: 8000, department: "Milling", designation: "Assistant Operator", fatherName: "Dolat Chodhary", joiningDate: "2026-03-01", email: "choudharygendalal6@gmail.com", phone: "8817608988", emergencyNo: "9111911260", bloodGroup: "" },
  { sno: 41, name: "Rishi Yadav", ctc: 38000, department: "Milling", designation: "Operator", fatherName: "Brahmnamd Yadav", joiningDate: "2025-08-05", email: "rishiyadav997798@gmail.com", phone: "8225883848", emergencyNo: "9977924767", bloodGroup: "" },
  { sno: 42, name: "Rahul Singh", ctc: 12000, department: "Milling", designation: "Assistant Operator", fatherName: "Rajendra Singh", joiningDate: "2026-01-10", email: "rahulsinghchoudhary1741@gmail.com", phone: "9340535789", emergencyNo: "9174968053", bloodGroup: "B+" },
  { sno: 43, name: "Gaurav Sharma", ctc: 20000, department: "Grain", designation: "Incharge", fatherName: "", joiningDate: "2025-11-21", email: "gauravsharma8998@gmail.com", phone: "9301807729", emergencyNo: "9754926662", bloodGroup: "O+" },
  { sno: 44, name: "Rajesh Verma", ctc: 0, department: "Grain", designation: "Unloading", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 45, name: "Mahendra Patel", ctc: 13500, department: "Grain", designation: "Unloading", fatherName: "Chatrabhuj Patel", joiningDate: "2026-02-26", email: "mahendrasinghpatel1978@gmail.com", phone: "9303291484", emergencyNo: "7440796755", bloodGroup: "B+" },
  { sno: 46, name: "Om Ji Patel", ctc: 12000, department: "Grain", designation: "Unloading", fatherName: "Ramesh Mehra", joiningDate: "2025-11-27", email: "omjimehra61012@gmail.com", phone: "9131939776", emergencyNo: "8889499427", bloodGroup: "O+" },
  { sno: 47, name: "Nitin Dubey", ctc: 13500, department: "Grain", designation: "Unloading", fatherName: "Chandra Shekhar", joiningDate: "2025-12-01", email: "nitind0125@gmail.com", phone: "9009640716", emergencyNo: "9981962517", bloodGroup: "O+" },
  { sno: 48, name: "Gopal Yadav", ctc: 20000, department: "Grain", designation: "Operator", fatherName: "Asarfi Lal yadav", joiningDate: "2025-10-14", email: "gopalchandyadav980@gmail.com", phone: "9721000224", emergencyNo: "9453269181", bloodGroup: "" },
  { sno: 49, name: "Devrath Tiwari", ctc: 15000, department: "Grain", designation: "Accounts", fatherName: "Ramsevak Tiwari", joiningDate: "2026-01-08", email: "", phone: "9770665510", emergencyNo: "9201433156", bloodGroup: "O+" },
  { sno: 50, name: "Vicky Moses", ctc: 15000, department: "Grain", designation: "Operator", fatherName: "Jhon Moses", joiningDate: "2026-03-01", email: "nishakhan11987@gmail.com", phone: "9303864955", emergencyNo: "9343342885", bloodGroup: "O+" },
  { sno: 51, name: "Amrendra Verma", ctc: 55000, department: "Dryer", designation: "Incharge", fatherName: "Ramu Verma", joiningDate: "2025-08-13", email: "amrendra727557@gmail.com", phone: "9399149570", emergencyNo: "7275579399", bloodGroup: "B+" },
  { sno: 52, name: "Surendra Nath Yadav", ctc: 15000, department: "Dryer", designation: "Operator", fatherName: "Ram Chet", joiningDate: "2026-01-28", email: "surendranathyadav205@gmail.com", phone: "9532792529", emergencyNo: "9839994271", bloodGroup: "" },
  { sno: 53, name: "Shikhar Chandra Verma", ctc: 38000, department: "Dryer", designation: "Operator", fatherName: "Mr kaniya lal verma", joiningDate: "2026-01-09", email: "290395shikhar@gmail.com", phone: "8349908961", emergencyNo: "9219055840", bloodGroup: "B+" },
  { sno: 54, name: "Sarvesh Kumar", ctc: 39000, department: "Dryer", designation: "Operator", fatherName: "Shiv Kumar", joiningDate: "2026-01-18", email: "sv8188068@gmail.com", phone: "9956671627", emergencyNo: "7754818869", bloodGroup: "O-" },
  { sno: 55, name: "Chandan Verma", ctc: 15000, department: "Dryer", designation: "Operator", fatherName: "Ram Milan Verma", joiningDate: "2026-01-18", email: "chandansingh956573@gmail.com", phone: "6306755015", emergencyNo: "6307614960", bloodGroup: "" },
  { sno: 56, name: "Chandrakesh Verma", ctc: 28000, department: "Dryer", designation: "Operator", fatherName: "Ram Milan Verma", joiningDate: "2025-12-06", email: "chandrakeshv123456789@gmail.com", phone: "7991319545", emergencyNo: "6307614960", bloodGroup: "AB+" },
  { sno: 57, name: "Deepak Pal", ctc: 0, department: "Dryer", designation: "Operator", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 58, name: "Viksit Pal", ctc: 40000, department: "Dryer", designation: "Operator", fatherName: "Jayvindra pal", joiningDate: "2026-03-23", email: "viksitpal62@gmail.com", phone: "9520202575", emergencyNo: "9690319181", bloodGroup: "" },
  { sno: 59, name: "Rajendra Yadav", ctc: 20000, department: "Decanter", designation: "Operator", fatherName: "Shree Shyam Bihari yadav", joiningDate: "2025-12-07", email: "yyadav85360@gmail.com", phone: "9919145434", emergencyNo: "9838455018", bloodGroup: "" },
  { sno: 60, name: "Vinit Rai Chandel", ctc: 30000, department: "Decanter", designation: "Operator", fatherName: "Ompal Singh", joiningDate: "2026-02-27", email: "vinitpal8755107142@gmail.com", phone: "8755107142", emergencyNo: "8265816988", bloodGroup: "AB+" },
  { sno: 61, name: "Neeraj Baghel", ctc: 33000, department: "Decanter", designation: "Operator", fatherName: "Rajendar baghel", joiningDate: "2026-02-03", email: "np8676217@gmail.com", phone: "7879534289", emergencyNo: "9826619295", bloodGroup: "" },
  { sno: 62, name: "Vijay Shankar Yadav", ctc: 50000, department: "WTP & CPU", designation: "Incharge", fatherName: "Kamla prasad", joiningDate: "2025-09-15", email: "vshankarv1@gmail.com", phone: "9935038935", emergencyNo: "8299475798", bloodGroup: "A+" },
  { sno: 63, name: "Nandan Kumar", ctc: 35000, department: "WTP & CPU", designation: "Operator", fatherName: "Mathlash Thakur", joiningDate: "2026-08-01", email: "nandanmth4727@gmail.com", phone: "9572091085", emergencyNo: "7739970414", bloodGroup: "B+" },
  { sno: 64, name: "Rinku Kumar", ctc: 34000, department: "WTP & CPU", designation: "Operator", fatherName: "Vikram Singh", joiningDate: "2026-01-23", email: "rinkisinghsamalkhakumar@gmail.com", phone: "9340560598", emergencyNo: "9058505455", bloodGroup: "O+" },
  { sno: 65, name: "Tej Pratap", ctc: 32000, department: "WTP & CPU", designation: "Operator", fatherName: "Sugriv Singh", joiningDate: "2026-01-30", email: "tejpratap2102@gmail.com", phone: "9507575832", emergencyNo: "9939493584", bloodGroup: "O+" },
  { sno: 66, name: "Shivam Vanshkar", ctc: 12000, department: "WTP & CPU", designation: "Helper", fatherName: "Anokhi Lal Vanshkar", joiningDate: "2026-02-19", email: "shivammahoviya@gmail.com", phone: "7724909432", emergencyNo: "8827043150", bloodGroup: "" },
  { sno: 67, name: "Subham Sahu", ctc: 12000, department: "WTP & CPU", designation: "Helper", fatherName: "Dharam Singh", joiningDate: "2025-12-28", email: "shubhamnsp2023@gmail.com", phone: "6267139195", emergencyNo: "9301726728", bloodGroup: "" },
  { sno: 68, name: "Adarsh Patel", ctc: 12000, department: "WTP & CPU", designation: "Helper", fatherName: "Ujyar Singh Patel", joiningDate: "2025-12-01", email: "pateladarsh222@gmail.com", phone: "7389598559", emergencyNo: "9981851186", bloodGroup: "" },
  { sno: 69, name: "Amit Rajput", ctc: 12000, department: "WTP & CPU", designation: "Helper", fatherName: "Shyam Singh Rajput", joiningDate: "2025-12-15", email: "rajpootaman452@gmail.com", phone: "9340593018", emergencyNo: "8253048197", bloodGroup: "A+" },
  { sno: 70, name: "Neetu Singh", ctc: 32000, department: "Fire & Safety", designation: "Officer", fatherName: "Akbar Singh", joiningDate: "2026-02-23", email: "ns5866505@gmail.com", phone: "8923538110", emergencyNo: "9870654057", bloodGroup: "B+" },
  { sno: 71, name: "Satya Jeet Singh", ctc: 22000, department: "Fire & Safety", designation: "Officer", fatherName: "Sheshnath yadav", joiningDate: "2026-01-16", email: "wkumar238@gmail.com", phone: "7320916212", emergencyNo: "9572854870", bloodGroup: "" },
  { sno: 72, name: "Bantu Yadav", ctc: 35000, department: "Fire & Safety", designation: "Officer", fatherName: "Mahesh Chandra", joiningDate: "2026-02-28", email: "bantuyadav044@gmail.com", phone: "9759642842", emergencyNo: "9548598543", bloodGroup: "" },
  { sno: 73, name: "Tahendra Sharma", ctc: 35000, department: "Lab", designation: "Incharge", fatherName: "Rajendra Sharma", joiningDate: "2026-01-19", email: "tahendrasharma653@gmail.com", phone: "9170861363", emergencyNo: "7828195417", bloodGroup: "" },
  { sno: 74, name: "Ram Pravesh Yadav", ctc: 32000, department: "Lab", designation: "Chemist", fatherName: "Radha Shyam Yadav", joiningDate: "2026-02-10", email: "ramyadav2397@gmail.com", phone: "7860091982", emergencyNo: "9838365307", bloodGroup: "" },
  { sno: 75, name: "Rahul Yadav", ctc: 28000, department: "Lab", designation: "Chemist", fatherName: "Laklhan Yadav", joiningDate: "2025-12-12", email: "ry227836@gmail.com", phone: "6267047774", emergencyNo: "9131111711", bloodGroup: "" },
  { sno: 76, name: "Tanisha Mishra", ctc: 35000, department: "Lab", designation: "Asst Manager QC", fatherName: "Promod kumar mishra", joiningDate: "2026-02-10", email: "mishratanisha016@gmail.com", phone: "6261466717", emergencyNo: "7828401544", bloodGroup: "O+" },
  { sno: 77, name: "Avneesh Kushwaha", ctc: 29000, department: "Lab", designation: "Chemist", fatherName: "Kashi Prasad Kushwaha", joiningDate: "2026-03-20", email: "avnishkushwaha412@gmail.com", phone: "8966896778", emergencyNo: "7898137100", bloodGroup: "O+" },
  { sno: 78, name: "Sakshi Patel", ctc: 15000, department: "Lab", designation: "Jr. Chemist", fatherName: "Shiv kumar Patel", joiningDate: "2026-11-02", email: "sakshinsp2020@gmail.com", phone: "6262922519", emergencyNo: "9977414452", bloodGroup: "B+" },
  { sno: 79, name: "Poornima Davariya", ctc: 10000, department: "Lab", designation: "Intern", fatherName: "Anil Davariya", joiningDate: "2026-03-16", email: "poornimadagoriya@gmail.com", phone: "7697457588", emergencyNo: "9174690326", bloodGroup: "A+" },
  { sno: 80, name: "Riya Chorisiya", ctc: 10000, department: "Lab", designation: "Intern", fatherName: "Uma Shankar Chorisiya", joiningDate: "2026-03-18", email: "chourasiyariya28042003@gmail.com", phone: "7067185582", emergencyNo: "9993280499", bloodGroup: "O+" },
  { sno: 81, name: "Nand Kishore Verma", ctc: 10000, department: "Lab", designation: "Helper", fatherName: "Vishnu Verma", joiningDate: "2026-03-12", email: "verma.nandkishore1995@gmail.com", phone: "6260197811", emergencyNo: "9753583907", bloodGroup: "O+" },
  { sno: 82, name: "Suraj Soni", ctc: 12000, department: "Lab", designation: "Helper", fatherName: "Prakesah Chandra Swami", joiningDate: "2026-01-22", email: "", phone: "7582932219", emergencyNo: "", bloodGroup: "B+" },
  { sno: 83, name: "Mithalesh Kumar Yadav", ctc: 45000, department: "Mechanical", designation: "Engineer", fatherName: "Banke Lal Yadav", joiningDate: "2025-12-09", email: "mky7891@gmail.com", phone: "8969334802", emergencyNo: "7017378423", bloodGroup: "AB+" },
  { sno: 84, name: "Santosh", ctc: 0, department: "Mechanical", designation: "Helper", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 85, name: "Mohammad Azam", ctc: 38000, department: "Mechanical", designation: "Turner/Fitter", fatherName: "Israr Khan", joiningDate: "2026-01-01", email: "mevazam69@gmail.com", phone: "9981535728", emergencyNo: "9669378121", bloodGroup: "" },
  { sno: 86, name: "Shashikant Singh", ctc: 35000, department: "Mechanical", designation: "Fitter", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 87, name: "Arvind Kumar Mishra", ctc: 34000, department: "Mechanical", designation: "Fitter", fatherName: "Brigesh Kumar Mishra", joiningDate: "2025-12-31", email: "arvindmishra4431@gmail.com", phone: "8736972302", emergencyNo: "9628236932", bloodGroup: "" },
  { sno: 88, name: "Prateek Kumar Tirode", ctc: 28000, department: "Mechanical", designation: "Fitter", fatherName: "Bhaskar Rao Tirode", joiningDate: "2025-12-12", email: "prateektirode@gmail.com", phone: "6261505136", emergencyNo: "7440731128", bloodGroup: "O+" },
  { sno: 89, name: "Hemraj Dubey", ctc: 40000, department: "Mechanical", designation: "Sr. Fitter", fatherName: "Navratan Dubey", joiningDate: "2025-10-15", email: "hemrajdubey9926@gmail.com", phone: "9926962237", emergencyNo: "7067234837", bloodGroup: "" },
  { sno: 90, name: "Dilip Singh", ctc: 30000, department: "Mechanical", designation: "Fitter/Welder", fatherName: "Ram Prasad Singh", joiningDate: "2025-11-02", email: "", phone: "9302466662", emergencyNo: "", bloodGroup: "O+" },
  { sno: 91, name: "Vikash", ctc: 0, department: "Mechanical", designation: "Helper", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 92, name: "Rahul", ctc: 0, department: "Mechanical", designation: "Helper", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 93, name: "Nishant Saini", ctc: 22000, department: "Mechanical", designation: "Fitter", fatherName: "Pradeep Kumar", joiningDate: "2026-02-23", email: "nishant66778899@gmail.com", phone: "8872143924", emergencyNo: "8171714653", bloodGroup: "" },
  { sno: 94, name: "Ratnesh Gurde", ctc: 32000, department: "Mechanical", designation: "Fitter", fatherName: "", joiningDate: "2025-10-24", email: "", phone: "", emergencyNo: "", bloodGroup: "O+" },
  { sno: 95, name: "Chhotelal Patel", ctc: 35000, department: "Mechanical", designation: "Fitter", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 96, name: "Ajay Rajak", ctc: 12000, department: "Mechanical", designation: "Helper", fatherName: "Omparkash rajak", joiningDate: "2026-02-01", email: "aajurajak51@gmail.com", phone: "7803002544", emergencyNo: "8305219899", bloodGroup: "" },
  { sno: 97, name: "Devendra Singh Thakur", ctc: 12000, department: "Mechanical", designation: "Helper", fatherName: "Ramesh Chandra Thakur", joiningDate: "2025-12-31", email: "singhthakurdevendra05@gmail.com", phone: "9424645758", emergencyNo: "9752712721", bloodGroup: "B+" },
  { sno: 98, name: "Ratan Kumar Goun", ctc: 15000, department: "Mechanical", designation: "Helper", fatherName: "", joiningDate: "2026-02-12", email: "ratakumar@gmail.com", phone: "9161823617", emergencyNo: "9795787582", bloodGroup: "" },
  { sno: 99, name: "Ajmer Khan", ctc: 15000, department: "Mechanical", designation: "Helper", fatherName: "Naser Khan", joiningDate: "2026-02-04", email: "", phone: "7869217160", emergencyNo: "6261592577", bloodGroup: "" },
  { sno: 100, name: "Mahendra Kumar", ctc: 15000, department: "Mechanical", designation: "Helper", fatherName: "", joiningDate: "2026-02-14", email: "", phone: "9369405593", emergencyNo: "7054339378", bloodGroup: "" },
  { sno: 101, name: "Sarwar Ali", ctc: 22795, department: "Civil", designation: "Supervisor", fatherName: "", joiningDate: null, email: "sarwarmohd770@gmail.com", phone: "6397241600", emergencyNo: "", bloodGroup: "" },
  { sno: 102, name: "Umesh Uikey", ctc: 10000, department: "Civil", designation: "Supervisor", fatherName: "Balak Ram Uikey", joiningDate: "2024-10-15", email: "Umeshuikey1750@gmail.com", phone: "8889846550", emergencyNo: "7803968344", bloodGroup: "O+" },
  { sno: 103, name: "Preetam Vishwakarma", ctc: 10000, department: "Driver", designation: "Driver", fatherName: "", joiningDate: null, email: "", phone: "", emergencyNo: "", bloodGroup: "" },
  { sno: 104, name: "Vijay Vishwakarma", ctc: 25000, department: "RMC", designation: "Operator", fatherName: "", joiningDate: "2024-11-22", email: "", phone: "7722934969", emergencyNo: "9479382093", bloodGroup: "" },
];

async function main() {
  // 1. Collect unique departments & designations
  const deptNames = [...new Set(employees.map(e => e.department))];
  const desigTitles = [...new Set(employees.map(e => e.designation).filter(Boolean))];

  // 2. Upsert departments
  const deptMap: Record<string, string> = {};
  for (const name of deptNames) {
    const dept = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    deptMap[name] = dept.id;
  }
  console.log(`Departments: ${Object.keys(deptMap).length} upserted`);

  // 3. Upsert designations
  const desigMap: Record<string, string> = {};
  for (const title of desigTitles) {
    const desig = await prisma.designation.upsert({
      where: { title },
      update: {},
      create: { title },
    });
    desigMap[title] = desig.id;
  }
  console.log(`Designations: ${Object.keys(desigMap).length} upserted`);

  // 4. Create employees
  let created = 0;
  let skipped = 0;
  for (const emp of employees) {
    const nameParts = emp.name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');
    const empCode = `MSPIL-${String(emp.sno).padStart(3, '0')}`;

    // Skip if empCode already exists
    const existing = await prisma.employee.findUnique({ where: { empCode } });
    if (existing) { skipped++; continue; }

    const dateOfJoining = emp.joiningDate ? new Date(emp.joiningDate) : new Date('2025-01-01');

    await prisma.employee.create({
      data: {
        empCode,
        firstName,
        lastName,
        fatherName: emp.fatherName || null,
        dateOfJoining: dateOfJoining,
        phone: emp.phone || null,
        email: emp.email || null,
        emergencyPhone: emp.emergencyNo || null,
        bloodGroup: emp.bloodGroup || null,
        ctcAnnual: (emp.ctc || 0) * 12,
        basicMonthly: emp.ctc || 0,
        designationId: emp.designation ? desigMap[emp.designation] : null,
        departmentId: deptMap[emp.department],
        employmentType: 'PERMANENT',
        workLocation: 'FACTORY',
        status: 'ACTIVE',
        isActive: true,
      },
    });
    created++;
  }

  console.log(`Employees: ${created} created, ${skipped} skipped (already exist)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
