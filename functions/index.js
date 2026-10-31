const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { google } = require("googleapis");
const crypto = require("crypto");

initializeApp();

const db = getFirestore();

const SPREADSHEET_ID =
  "12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how";

const SHEET_NAME = "Admission Leads";

const RUNTIME_SERVICE_ACCOUNT =
  "fxec-admission-sheets@fxec-admission-enquiry.iam.gserviceaccount.com";

const ALLOWED_ORIGINS = [
  "https://fxec-admission-enquiry.web.app",
  "https://fxec-admission-enquiry.firebaseapp.com",
  "https://admissions.fxecdigital.org",
  "http://admissions.fxecdigital.org",
  "http://localhost:5000",
  "http://127.0.0.1:5000"
];

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10,
  serviceAccount: RUNTIME_SERVICE_ACCOUNT
});

const HEADERS = [
  "Enquiry ID",
  "Submission Timestamp",
  "Student Name",
  "Class",
  "Mode of Study",
  "District",
  "School Board / Category",
  "School Name",
  "X Standard Marks",
  "X Standard Maximum Marks",
  "XII Expected Marks",
  "XII Maximum Marks",
  "Merit Scholarship Interest",
  "Contact Number",
  "Email Address",
  "OTP Verification Channel",
  "Interest in Joining FXEC",
  "First Programme Preference",
  "Second Programme Preference",
  "Third Programme Preference"
];

function cors(req, res) {
  const rawOrigin = req.get("origin") || req.headers.origin || "";
  let origin = "";

  try {
    origin = rawOrigin ? new URL(rawOrigin).origin.toLowerCase() : "";
  } catch (_) {
    origin = "";
  }

  const allowedOrigins = new Set(
    ALLOWED_ORIGINS.map(value => {
      try { return new URL(value).origin.toLowerCase(); }
      catch (_) { return ""; }
    })
  );

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (origin && allowedOrigins.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    return true;
  }

  return !rawOrigin;
}

function respond(res, status, data) {
  return res.status(status).json(data);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function checkRequest(req, res) {
  if (!cors(req, res)) {
    respond(res, 403, { success: false, message: "Origin not allowed." });
    return false;
  }

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return false;
  }

  if (req.method !== "POST") {
    respond(res, 405, { success: false, message: "POST required." });
    return false;
  }

  return true;
}

// --------------------------------------------------
// GOOGLE SHEETS HELPERS
// --------------------------------------------------

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function ensureAdmissionSheet(sheets) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties"
  });

  const exists = metadata.data.sheets.some(
    sheet => sheet.properties.title === SHEET_NAME
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: SHEET_NAME }
          }
        }]
      }
    });
  }

  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:T1`
  });

  if (!headerCheck.data.values || !headerCheck.data.values.length || headerCheck.data.values[0].length < HEADERS.length || HEADERS.some((header, index) => headerCheck.data.values[0][index] !== header)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${SHEET_NAME}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] }
    });
  }
}

async function enquiryAlreadyExists(sheets, enquiryId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A2:A`
  });

  return (result.data.values || []).some(
    row => row[0] === enquiryId
  );
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function duplicateKey(type, value) {
  return crypto.createHash("sha256")
    .update(type + ":" + value)
    .digest("hex");
}

async function findExistingEnquiry(sheets, email, phone) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!N2:O`
  });

  const wantedEmail = String(email).trim().toLowerCase();
  const wantedPhone = normalizePhone(phone);

  for (const row of (result.data.values || [])) {
    const savedPhone = normalizePhone(row[0]);
    const savedEmail = String(row[1] || "").trim().toLowerCase();

    if ((wantedEmail && savedEmail === wantedEmail) ||
        (wantedPhone && savedPhone === wantedPhone)) {
      return true;
    }
  }

  return false;
}

function validateEnquiry(data) {
  const required = [
    "studentName",
    "district",
    "schoolBoard",
    "schoolName",
    "contactNumber",
    "email",
    "joiningInterest",
    "preference1"
  ];

  for (const key of required) {
    if (!String(data[key] || "").trim()) {
      throw new Error(`Missing field: ${key}`);
    }
  }

  if (String(data.studentName).length > 100 ||
      String(data.schoolName).length > 150) {
    throw new Error("Invalid name or school name.");
  }

  const districts = [
    "Kanyakumari",
    "Tirunelveli",
    "Thoothukudi",
    "Tenkasi",
    "Virudhunagar"
  ];

  if (!districts.includes(data.district)) {
    throw new Error("Invalid district.");
  }

  const boards = [
    "Matriculation",
    "CBSE",
    "IGCSE",
    "State Board Government School",
    "State Board Government Aided School",
    "Other / International Board"
  ];

  if (!boards.includes(data.schoolBoard)) {
    throw new Error("Invalid school board.");
  }

  const programmes = ["B.E Civil", "B.E CSE", "B.E ECE", "B.E EEE", "B.E Mech", "B.Tech IT", "B.Tech AI & DS"];
  if (!["Yes", "No"].includes(data.joiningInterest)) throw new Error("Invalid FXEC joining interest.");
  const preferences = [data.preference1, data.preference2, data.preference3].map(value => String(value || "").trim()).filter(Boolean);
  if (!preferences.length || preferences.some(value => !programmes.includes(value)) || new Set(preferences).size !== preferences.length) {
    throw new Error("Select valid, non-repeating programme preferences.");
  }

  const marks = [
    "xStandardMarks",
    "xiiExpectedMarks",
    "xiiMaximumMarks"
  ];

  for (const key of marks) {
    const value = Number(data[key]);

    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      throw new Error("Invalid marks entered.");
    }
  }

  if (Number(data.xiiExpectedMarks) > Number(data.xiiMaximumMarks)) {
    throw new Error("Expected XII marks cannot exceed maximum marks.");
  }

  const contact = String(data.contactNumber).replace(/[+\s()-]/g, "");

  if (!/^\d{8,15}$/.test(contact)) {
    throw new Error("Invalid contact number.");
  }

  if (!validEmail(String(data.email).trim())) {
    throw new Error("Invalid email address.");
  }

  return {
    ...data,
    contactNumber: String(data.contactNumber).trim(),
    email: String(data.email).trim().toLowerCase()
  };
}

// --------------------------------------------------
// SUBMIT ADMISSION ENQUIRY WITHOUT EMAIL OTP
// --------------------------------------------------
exports.submitAdmissionEnquiry = onRequest(
  { invoker: "public", cors: ALLOWED_ORIGINS },
  async (req, res) => {
    if (!checkRequest(req, res)) return;
    let reservationRefs = [];
    let enquiryId = "";
    try {
      const submittedData = req.body?.enquiry;
      if (!submittedData) return respond(res, 400, {success:false,message:"Please complete the admission enquiry form."});
      const enquiry = validateEnquiry(submittedData);
      const sheets = await getSheetsClient();
      await ensureAdmissionSheet(sheets);
      if (await findExistingEnquiry(sheets,enquiry.email,enquiry.contactNumber))
        return respond(res,409,{success:false,message:"You have already submitted your admission enquiry."});

      enquiryId = crypto.randomUUID();
      const emailRef=db.collection("admissionEnquiryLocks").doc(duplicateKey("email",enquiry.email));
      const phoneRef=db.collection("admissionEnquiryLocks").doc(duplicateKey("phone",normalizePhone(enquiry.contactNumber)));
      reservationRefs=[emailRef,phoneRef];

      const claim=await db.runTransaction(async transaction=>{
        const emailSnap=await transaction.get(emailRef);
        const phoneSnap=await transaction.get(phoneRef);
        if(emailSnap.exists||phoneSnap.exists)return "DUPLICATE";
        const lock={status:"submitting",enquiryId,createdAt:FieldValue.serverTimestamp()};
        transaction.create(emailRef,lock);transaction.create(phoneRef,lock);
        return "CLAIMED";
      });
      if(claim!=="CLAIMED")return respond(res,409,{success:false,message:"You have already submitted your admission enquiry."});

      await sheets.spreadsheets.values.append({
        spreadsheetId:SPREADSHEET_ID,range:`'${SHEET_NAME}'!A:T`,
        valueInputOption:"USER_ENTERED",insertDataOption:"INSERT_ROWS",
        requestBody:{values:[[
          enquiryId,new Date().toISOString(),enquiry.studentName,"XII","",
          enquiry.district,enquiry.schoolBoard,enquiry.schoolName,
          Number(enquiry.xStandardMarks),"",Number(enquiry.xiiExpectedMarks),
          Number(enquiry.xiiMaximumMarks),enquiry.meritScholarshipInterest?"Yes":"No",
          enquiry.contactNumber,enquiry.email,"",enquiry.joiningInterest,
          enquiry.preference1,enquiry.preference2||"",enquiry.preference3||""
        ]]}
      });
      await db.runTransaction(async transaction=>{
        for(const lockRef of reservationRefs)transaction.update(lockRef,{status:"submitted",submittedAt:FieldValue.serverTimestamp()});
      });
      return respond(res,200,{success:true,message:"Your admission enquiry has been submitted successfully."});
    } catch(error) {
      if(reservationRefs.length&&enquiryId)await db.runTransaction(async transaction=>{
        const snaps=await Promise.all(reservationRefs.map(lockRef=>transaction.get(lockRef)));
        snaps.forEach((snap,index)=>{if(snap.exists&&snap.data().enquiryId===enquiryId&&snap.data().status==="submitting")transaction.delete(reservationRefs[index])});
      }).catch(()=>{});
      loggerError("Enquiry submission failed",error.message);
      return respond(res,400,{success:false,message:"Unable to submit your enquiry. Please try again."});
    }
  }
);
// Keep logs free of OTPs, tokens and student information.
function loggerError(message, detail) {
  console.error(message, String(detail || "").slice(0, 200));
}