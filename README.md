# FXEC Admission Enquiry Portal

Mobile-first admission enquiry portal for Francis Xavier Engineering College.

## Files
- `index.html`: responsive admission form.
- `apps-script/Code.gs`: Google Apps Script backend for email OTP, verification and Google Sheets lead capture.

## Fields
Student name; Class XII (preselected); mode of study; district (Kanyakumari, Tirunelveli, Thoothukudi, Tenkasi, Virudhunagar); school category (Matriculation, CBSE, IGCSE, State Board Government, State Board Government Aided, Other/International); free-text school name; X marks obtained and maximum marks; expected XII marks and maximum marks; merit scholarship interest; mobile and email; WhatsApp or email OTP choice.

## Setup
1. Open https://docs.google.com/spreadsheets/d/12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how/edit
2. Extensions → Apps Script; paste `apps-script/Code.gs`.
3. Apps Script Project Settings → Script Properties: set `SPREADSHEET_ID` to `12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how`.
4. Deploy as Web App, execute as owner. Public access is required for public submissions; confirm institutional approval.
5. Set the deployed `/exec` URL in `APPS_SCRIPT_URL` in index.html.
6. Enable GitHub Pages from main branch, root folder.

Email OTP is implemented with MailApp. WhatsApp OTP is a deliberate configuration stub until the exact Interakt Authentication API endpoint, headers and approved template payload are confirmed. Keep credentials in Apps Script Script Properties, never in GitHub.

OTP lifetime 5 minutes; 5 failed attempts; 60-second resend cooldown. Only verified leads are written to the sheet. Add institution-approved privacy and consent wording before launch.