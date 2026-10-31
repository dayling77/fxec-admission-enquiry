const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { google } = require("googleapis");
const crypto = require("crypto");

initializeApp();

const db = getFirestore();

const ZEPTOMAIL_SEND_TOKEN = defineSecret("ZEPTOMAIL_SEND_TOKEN");
const OTP_HASH_SECRET = defineSecret("OTP_HASH_SECRET");

const EMAIL_API_URL = "https://api.zeptomail.in/v1.1/email";
const SENDER_EMAIL = "admin@fxecdigital.org";
const SENDER_NAME = "FXEC Admissions";

const SPREADSHEET_ID =
  "12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how";

const SHEET_NAME = "Admission Leads";

const RUNTIME_SERVICE_ACCOUNT =
  "fxec-admission-sheets@fxec-admission-enquiry.iam.gserviceaccount.com";

const ALLOWED_ORIGINS = [
  "https://fxec-admission-enquiry.web.app",
  "https://fxec-admission-enquiry.firebaseapp.com",
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
  "OTP Verification Channel"
];

function cors(req, res) {
  const origin = req.get("origin");

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    return true;
  }

  return !origin;
}

function respond(res, status, data) {
  return res.status(status).json(data);
}

function emailHash(email) {
  return crypto.createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex");
}

function secureHash(value) {
  return crypto.createHmac(
    "sha256",
    OTP_HASH_SECRET.value()
  ).update(value).digest("hex");
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
// 1. SEND EMAIL OTP
// --------------------------------------------------

exports.sendAdmissionOTP = onRequest(
  {
    invoker: "public",
    secrets: [ZEPTOMAIL_SEND_TOKEN, OTP_HASH_SECRET]
  },
  async (req, res) => {
    if (!checkRequest(req, res)) return;

    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const name = String(req.body?.name || "").trim();

      if (!validEmail(email) || !name || name.length > 100) {
        return respond(res, 400, {
          success: false,
          message: "Enter a valid name and email address."
        });
      }

      const now = Date.now();
      const lockRef = db.collection("admissionEmailLimits")
        .doc(emailHash(email));

      await db.runTransaction(async transaction => {
        const snap = await transaction.get(lockRef);
        const data = snap.exists ? snap.data() : {};

        const windowStart = data.windowStart || now;
        const count = now - windowStart > 15 * 60 * 1000
          ? 0
          : (data.sendCount || 0);

        if (data.lastSentAt && now - data.lastSentAt < 60000) {
          throw new Error("OTP_COOLDOWN");
        }

        if (count >= 3) {
          throw new Error("OTP_LIMIT");
        }

        transaction.set(lockRef, {
          windowStart: count === 0 ? now : windowStart,
          sendCount: count + 1,
          lastSentAt: now
        });
      });

      const otp = String(crypto.randomInt(100000, 1000000));
      const verificationId = crypto.randomUUID();

      await db.collection("admissionOTP").doc(verificationId).set({
        email,
        name,
        otpHash: secureHash(otp),
        status: "pending",
        attempts: 0,
        expiresAt: now + 5 * 60 * 1000,
        createdAt: FieldValue.serverTimestamp()
      });

      const safeName = escapeHtml(name);

      const emailPayload = {
        from: {
          address: SENDER_EMAIL,
          name: SENDER_NAME
        },
        to: [{
          email_address: {
            address: email,
            name
          }
        }],
        subject: "Your FXEC Admission Enquiry Verification Code",
        htmlbody: `
          <div style="font-family:Arial,sans-serif;max-width:520px;
                      margin:auto;border:1px solid #ddd;border-radius:10px;
                      overflow:hidden;">
            <div style="background:#123b70;color:white;padding:22px;">
              <h2 style="margin:0;">FXEC Admissions</h2>
              <p style="margin:6px 0 0;">Email Verification</p>
            </div>
            <div style="padding:25px;color:#222;">
              <p>Dear ${safeName},</p>
              <p>Your verification code is:</p>
              <div style="font-size:32px;font-weight:bold;letter-spacing:8px;
                          color:#123b70;padding:15px 0;">
                ${otp}
              </div>
              <p>This code expires in <b>5 minutes</b>.</p>
              <p>If you did not request this code, please ignore this email.</p>
              <p>Regards,<br><b>FXEC Admissions Team</b></p>
            </div>
          </div>
        `,
        textbody:
          `Dear ${name}, your FXEC verification code is ${otp}. ` +
          "It expires in 5 minutes."
      };

      const mailResponse = await fetch(EMAIL_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Zoho-enczapikey ${ZEPTOMAIL_SEND_TOKEN.value()}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(emailPayload)
      });

      if (!mailResponse.ok) {
        await db.collection("admissionOTP")
          .doc(verificationId).delete();

        loggerError("Email provider rejected request", mailResponse.status);

        return respond(res, 502, {
          success: false,
          message: "Unable to send verification email. Please try again later."
        });
      }

      return respond(res, 200, {
        success: true,
        verificationId,
        message: "Verification code sent successfully."
      });

    } catch (error) {
      if (error.message === "OTP_COOLDOWN") {
        return respond(res, 429, {
          success: false,
          message: "Please wait 60 seconds before requesting another code."
        });
      }

      if (error.message === "OTP_LIMIT") {
        return respond(res, 429, {
          success: false,
          message: "OTP request limit reached. Try again after 15 minutes."
        });
      }

      loggerError("Send OTP failed", error.message);

      return respond(res, 500, {
        success: false,
        message: "Unable to process your request."
      });
    }
  }
);

// --------------------------------------------------
// 2. VERIFY EMAIL OTP
// --------------------------------------------------

exports.verifyAdmissionOTP = onRequest(
  {
    invoker: "public",
    secrets: [OTP_HASH_SECRET]
  },
  async (req, res) => {
    if (!checkRequest(req, res)) return;

    try {
      const verificationId = String(req.body?.verificationId || "");
      const email = String(req.body?.email || "").trim().toLowerCase();
      const otp = String(req.body?.otp || "");

      if (!verificationId || !validEmail(email) ||
          !/^\d{6}$/.test(otp)) {
        return respond(res, 400, {
          success: false,
          message: "Invalid verification details."
        });
      }

      const ref = db.collection("admissionOTP").doc(verificationId);
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = secureHash(verificationToken);

      const result = await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);

        if (!snap.exists) return "INVALID";

        const data = snap.data();

        if (data.email !== email || data.status !== "pending") {
          return "INVALID";
        }

        if (Date.now() > data.expiresAt) {
          transaction.update(ref, { status: "expired" });
          return "EXPIRED";
        }

        if (data.attempts >= 5) return "LOCKED";

        const suppliedHash = Buffer.from(secureHash(otp), "hex");
        const storedHash = Buffer.from(data.otpHash, "hex");

        const correct =
          suppliedHash.length === storedHash.length &&
          crypto.timingSafeEqual(suppliedHash, storedHash);

        if (!correct) {
          const attempts = data.attempts + 1;

          transaction.update(ref, {
            attempts,
            ...(attempts >= 5 ? { status: "locked" } : {})
          });

          return "WRONG";
        }

        transaction.update(ref, {
          status: "verified",
          tokenHash,
          tokenExpiresAt: Date.now() + 10 * 60 * 1000,
          verifiedAt: FieldValue.serverTimestamp()
        });

        return "VERIFIED";
      });

      if (result !== "VERIFIED") {
        return respond(res, 400, {
          success: false,
          message: {
            INVALID: "Invalid verification request.",
            EXPIRED: "The code has expired. Request a new one.",
            LOCKED: "Too many attempts. Request a new code.",
            WRONG: "Incorrect code. Please try again."
          }[result]
        });
      }

      return respond(res, 200, {
        success: true,
        verificationToken,
        message: "Email verified successfully."
      });

    } catch (error) {
      loggerError("OTP verification failed", error.message);

      return respond(res, 500, {
        success: false,
        message: "Unable to verify the code."
      });
    }
  }
);

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
    range: `'${SHEET_NAME}'!A1:P1`
  });

  if (!headerCheck.data.values || !headerCheck.data.values.length) {
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

function validateEnquiry(data) {
  const required = [
    "studentName",
    "modeOfStudy",
    "district",
    "schoolBoard",
    "schoolName",
    "contactNumber",
    "email"
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

  const marks = [
    "xStandardMarks",
    "xStandardMaximumMarks",
    "xiiExpectedMarks",
    "xiiMaximumMarks"
  ];

  for (const key of marks) {
    const value = Number(data[key]);

    if (!Number.isFinite(value) || value < 0 || value > 1000) {
      throw new Error("Invalid marks entered.");
    }
  }

  if (Number(data.xStandardMarks) >
      Number(data.xStandardMaximumMarks) ||
      Number(data.xiiExpectedMarks) >
      Number(data.xiiMaximumMarks)) {
    throw new Error("Marks cannot exceed maximum marks.");
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
// 3. SUBMIT VERIFIED ADMISSION ENQUIRY
// --------------------------------------------------

exports.submitAdmissionEnquiry = onRequest(
  {
    invoker: "public",
    secrets: [OTP_HASH_SECRET]
  },
  async (req, res) => {
    if (!checkRequest(req, res)) return;

    let ref;

    try {
      const token = String(req.body?.verificationToken || "");
      const submittedData = req.body?.enquiry;

      if (!/^[a-f0-9]{64}$/.test(token) || !submittedData) {
        return respond(res, 400, {
          success: false,
          message: "Verification is required before submission."
        });
      }

      const enquiry = validateEnquiry(submittedData);

      const tokenHash = secureHash(token);
      const query = await db.collection("admissionOTP")
        .where("tokenHash", "==", tokenHash)
        .limit(1)
        .get();

      if (query.empty) {
        return respond(res, 403, {
          success: false,
          message: "Verification expired. Please verify your email again."
        });
      }

      ref = query.docs[0].ref;

      const claim = await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);

        if (!snap.exists) return false;

        const data = snap.data();

        if (data.status === "submitted") return "SUBMITTED";

        if (data.status !== "verified" ||
            data.tokenExpiresAt < Date.now() ||
            data.email !== enquiry.email) {
          return false;
        }

        transaction.update(ref, { status: "submitting" });
        return true;
      });

      if (claim === "SUBMITTED") {
        return respond(res, 200, {
          success: true,
          message: "This enquiry has already been submitted."
        });
      }

      if (claim !== true) {
        return respond(res, 403, {
          success: false,
          message: "Verification expired or does not match this email."
        });
      }

      const sheets = await getSheetsClient();
      await ensureAdmissionSheet(sheets);

      const enquiryId = ref.id;
      const exists = await enquiryAlreadyExists(sheets, enquiryId);

      if (!exists) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${SHEET_NAME}'!A:P`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: {
            values: [[
              enquiryId,
              new Date().toISOString(),
              enquiry.studentName,
              "XII",
              enquiry.modeOfStudy,
              enquiry.district,
              enquiry.schoolBoard,
              enquiry.schoolName,
              Number(enquiry.xStandardMarks),
              Number(enquiry.xStandardMaximumMarks),
              Number(enquiry.xiiExpectedMarks),
              Number(enquiry.xiiMaximumMarks),
              enquiry.meritScholarshipInterest ? "Yes" : "No",
              enquiry.contactNumber,
              enquiry.email,
              "Email"
            ]]
          }
        });
      }

      await ref.update({
        status: "submitted",
        submittedAt: FieldValue.serverTimestamp()
      });

      return respond(res, 200, {
        success: true,
        message: "Your admission enquiry has been submitted successfully."
      });

    } catch (error) {
      if (ref) {
        await ref.update({ status: "verified" }).catch(() => {});
      }

      loggerError("Enquiry submission failed", error.message);

      return respond(res, 400, {
        success: false,
        message: "Unable to submit your enquiry. Please try again."
      });
    }
  }
);

// Keep logs free of OTPs, tokens and student information.
function loggerError(message, detail) {
  console.error(message, String(detail || "").slice(0, 200));
}