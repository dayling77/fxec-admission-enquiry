# Deploy the live FXEC enquiry form

The live form is served by Google Apps Script HTML Service. GitHub is the source repository. This approach uses google.script.run and avoids browser CORS issues between GitHub Pages and Apps Script.

## A. Create the Apps Script project

1. Open the spreadsheet: https://docs.google.com/spreadsheets/d/12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how/edit
2. Select Extensions → Apps Script.
3. Replace the default Code.gs with the contents of this repository's `apps-script/Code.gs`.
4. In Apps Script, click + next to Files → HTML. Name the file exactly `Index` (Apps Script will create Index.html).
5. Paste the contents of this repository's `apps-script/Index.html` into that file.

## B. Add Script Properties

Apps Script → Project Settings → Script Properties. Add:

| Property | Value |
|---|---|
| SPREADSHEET_ID | 12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how |
| INTERAKT_API_KEY | API key from Interakt Developer Settings |
| INTERAKT_AUTH_TEMPLATE_NAME | Approved WhatsApp Authentication template code name |
| INTERAKT_OTP_LANGUAGE_CODE | Exact language code approved for the template, e.g. en |

Keep these values in Script Properties. Do not put the API key in GitHub or the HTML.

## C. Interakt prerequisites

1. In Meta Business Manager, create/obtain an approved WhatsApp Authentication template with a copy-code button.
2. Sync the approved template into Interakt.
3. Get the template code name from Interakt's template details.
4. Get the API key from Interakt → Developer Settings.
5. Ensure the API key has access to the public Template Sending API. Interakt documents POST `https://api.interakt.ai/v1/public/message/` with `Authorization: Basic YOUR_API_KEY`.
6. The code sends the same six-digit OTP in `bodyValues` and `buttonValues["0"]`. The approved template must have the matching copy-code button at index 0 and one OTP body variable.

## D. Deploy

1. Save both Apps Script files.
2. Select Deploy → New deployment → Web app.
3. Execute as: Me (the spreadsheet owner / authorised sender).
4. Who has access: Anyone, if this is a public admissions form and your institution approves public access.
5. Click Deploy and authorise Google Sheets, external requests and email permissions when prompted.
6. Copy the Web App URL ending in `/exec`. That is the live form URL.
7. Open it in an incognito/private browser and test both Email OTP and WhatsApp OTP with your own contact details.

## E. Test checklist

- Email OTP arrives and expires after five minutes.
- WhatsApp Authentication OTP arrives using the approved template.
- Incorrect OTP is rejected; maximum five attempts.
- Resend is rate-limited to one request per 60 seconds per channel/destination.
- Submission is rejected until contact verification succeeds.
- A verified lead creates a row in the `Admission Leads` tab.
- Changing any form value after OTP issuance requires a fresh OTP.
- Verify the consent text and privacy notice with the institution before public launch.

## Notes
- The live application is the Apps Script Web App URL, not the repository's GitHub Pages URL.
- This repository is public at present. Keep it free of credentials and personal/student data.
- Email delivery uses MailApp. The first deployment will request permission.
- WhatsApp template sends may incur Meta/Interakt authentication-template charges.
