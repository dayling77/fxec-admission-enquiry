/**
 * FXEC Admission Enquiry Portal
 * Deploy this Apps Script project as a Web App.
 * Required Script Properties:
 * SPREADSHEET_ID
 * INTERAKT_API_KEY
 * INTERAKT_AUTH_TEMPLATE_NAME
 * INTERAKT_OTP_LANGUAGE_CODE (usually en; must match approved template)
 */
const CFG = { SHEET: 'Admission Leads', OTP_TTL: 300, VERIFIED_TTL: 600, MAX_ATTEMPTS: 5, RESEND_SECONDS: 60 };

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FXEC | Admission Enquiry')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function sendOtp(input) {
  const lead = validateLead_(input);
  const channel = lead.otpChannel;
  const destination = channel === 'email' ? lead.email : lead.mobile;
  const cooldownKey = 'COOL_' + sha256_(channel + ':' + destination);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const last = Number(PropertiesService.getScriptProperties().getProperty(cooldownKey) || 0);
    if (Date.now() - last < CFG.RESEND_SECONDS * 1000) {
      throw new Error('Please wait 60 seconds before requesting another OTP.');
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const requestId = Utilities.getUuid();
    const record = {
      otpHash: sha256_(requestId + ':' + code),
      leadHash: sha256_(JSON.stringify(lead)),
      lead: lead,
      channel: channel,
      createdAt: Date.now(),
      expiresAt: Date.now() + CFG.OTP_TTL * 1000,
      attempts: 0,
      verified: false
    };
    const props = PropertiesService.getScriptProperties();
    props.setProperty('OTP_' + requestId, JSON.stringify(record));
    try {
      if (channel === 'email') {
        MailApp.sendEmail({
          to: lead.email,
          subject: 'Your FXEC Admission Enquiry Verification Code',
          body: 'Your FXEC verification code is ' + code + '. It expires in 5 minutes. Do not share this code with anyone.'
        });
      } else {
        sendInteraktAuthenticationOtp_(lead.mobile, code, requestId);
      }
      props.setProperty(cooldownKey, String(Date.now()));
    } catch (err) {
      props.deleteProperty('OTP_' + requestId);
      throw err;
    }
    return { ok: true, requestId: requestId, message: 'OTP sent successfully.' };
  } finally {
    lock.releaseLock();
  }
}

function verifyOtp(requestId, code) {
  requestId = String(requestId || '');
  code = String(code || '');
  if (!requestId || !/^\\d{6}$/.test(code)) throw new Error('Enter the valid 6-digit OTP.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'OTP_' + requestId;
    const raw = props.getProperty(key);
    if (!raw) throw new Error('OTP request not found. Please request a new code.');
    const record = JSON.parse(raw);
    if (Date.now() > record.expiresAt) {
      props.deleteProperty(key);
      throw new Error('OTP expired. Please request a new code.');
    }
    if (record.verified) return { ok: true, message: 'Contact already verified.' };
    record.attempts++;
    if (record.attempts > CFG.MAX_ATTEMPTS) {
      props.deleteProperty(key);
      throw new Error('Too many incorrect attempts. Please request a new OTP.');
    }
    if (sha256_(requestId + ':' + code) !== record.otpHash) {
      props.setProperty(key, JSON.stringify(record));
      throw new Error('Incorrect OTP. Please try again.');
    }
    record.verified = true;
    record.verifiedAt = Date.now();
    props.setProperty(key, JSON.stringify(record));
    return { ok: true, message: 'Contact verified successfully.' };
  } finally {
    lock.releaseLock();
  }
}

function submitLead(requestId, input) {
  requestId = String(requestId || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'OTP_' + requestId;
    const raw = props.getProperty(key);
    if (!raw) throw new Error('Verification session expired. Please verify again.');
    const record = JSON.parse(raw);
    if (!record.verified || Date.now() > record.verifiedAt + CFG.VERIFIED_TTL * 1000) {
      props.deleteProperty(key);
      throw new Error('Please verify your contact again before submitting.');
    }
    const lead = validateLead_(input);
    if (sha256_(JSON.stringify(lead)) !== record.leadHash || lead.otpChannel !== record.channel) {
      throw new Error('Your details changed after OTP was sent. Please request a new OTP.');
    }
    const spreadsheetId = props.getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Administrator setup incomplete: SPREADSHEET_ID is missing.');
    const ss = SpreadsheetApp.openById(spreadsheetId);
    let sheet = ss.getSheetByName(CFG.SHEET);
    if (!sheet) sheet = ss.insertSheet(CFG.SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Submission ID','Submitted At','Student Name','Class','Mode of Study','District',
        'School Board / Category','School Name','X Marks Obtained','X Maximum Marks',
        'XII Expected Marks','XII Maximum Marks','Merit Scholarship Interest',
        'Mobile Number','Email Address','Verification Method','Verification Status','Consent'
      ]);
      sheet.setFrozenRows(1);
    }
    const submissionId = Utilities.getUuid();
    sheet.appendRow([
      submissionId, new Date(), lead.studentName, 'XII', lead.modeOfStudy, lead.district,
      lead.schoolCategory, lead.schoolName, lead.xMarks, lead.xMax, lead.xiiExpected,
      lead.xiiMax, lead.scholarship, lead.mobile, lead.email,
      record.channel, 'Verified', 'Yes'
    ]);
    props.deleteProperty(key);
    return { ok: true, submissionId: submissionId, message: 'Admission enquiry submitted successfully.' };
  } finally {
    lock.releaseLock();
  }
}

function validateLead_(p) {
  const required = ['studentName','modeOfStudy','district','schoolCategory','schoolName','xMarks','xMax','xiiExpected','xiiMax','scholarship','mobile','email','otpChannel'];
  required.forEach(function (key) {
    if (p[key] === undefined || String(p[key]).trim() === '') throw new Error('Please complete all required fields.');
  });
  if (!['Kanyakumari','Tirunelveli','Thoothukudi','Tenkasi','Virudhunagar'].includes(p.district)) throw new Error('Invalid district.');
  if (!['Matriculation','CBSE','IGCSE','State Board – Government School','State Board – Government Aided School','Other / International Board'].includes(p.schoolCategory)) throw new Error('Invalid school category.');
  if (!['email','whatsapp'].includes(p.otpChannel)) throw new Error('Invalid verification method.');
  const mobile = String(p.mobile).replace(/\\D/g, '');
  if (!/^[6-9]\\d{9}$/.test(mobile)) throw new Error('Enter a valid 10-digit Indian mobile number.');
  const x = Number(p.xMarks), xm = Number(p.xMax), xii = Number(p.xiiExpected), xiim = Number(p.xiiMax);
  if (![x,xm,xii,xiim].every(Number.isFinite) || x < 0 || xm <= 0 || xii < 0 || xiim <= 0 || x > xm || xii > xiim) {
    throw new Error('Please check the marks. Obtained / expected marks cannot exceed maximum marks.');
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(p.email).trim())) throw new Error('Enter a valid email address.');
  if (p.consent !== true) throw new Error('Consent is required.');
  if (!['Yes','No'].includes(String(p.scholarship))) throw new Error('Please select scholarship interest.');
  return {
    studentName: String(p.studentName).trim().slice(0,100),
    modeOfStudy: String(p.modeOfStudy).trim().slice(0,60),
    district: p.district,
    schoolCategory: p.schoolCategory,
    schoolName: String(p.schoolName).trim().slice(0,160),
    xMarks: x, xMax: xm, xiiExpected: xii, xiiMax: xiim,
    scholarship: String(p.scholarship),
    mobile: mobile,
    email: String(p.email).trim().toLowerCase().slice(0,160),
    otpChannel: p.otpChannel,
    consent: true
  };
}

function sendInteraktAuthenticationOtp_(mobile, code, requestId) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('INTERAKT_API_KEY');
  const templateName = props.getProperty('INTERAKT_AUTH_TEMPLATE_NAME');
  const languageCode = props.getProperty('INTERAKT_OTP_LANGUAGE_CODE') || 'en';
  if (!apiKey || !templateName) {
    throw new Error('WhatsApp OTP is not configured. Please choose Email OTP or contact the administrator.');
  }
  const payload = {
    countryCode: '+91',
    phoneNumber: mobile,
    callbackData: 'FXEC_ADMISSION_' + requestId,
    type: 'Template',
    template: {
      name: templateName,
      languageCode: languageCode,
      bodyValues: [code],
      buttonValues: { '0': [code] }
    }
  };
  const response = UrlFetchApp.fetch('https://api.interakt.ai/v1/public/message/', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Basic ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  let result = {};
  try { result = JSON.parse(text); } catch (e) {}
  if (status < 200 || status >= 300 || result.result === false) {
    console.error('Interakt API error ' + status + ': ' + text);
    throw new Error('Interakt could not send the OTP. Check the API key, approved Authentication Template and template language in Interakt.');
  }
  return result;
}

function sha256_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
