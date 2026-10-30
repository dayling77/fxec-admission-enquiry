# FXEC Admission Enquiry Portal

Mobile-first admission enquiry portal for Francis Xavier Engineering College.

## Architecture
- GitHub repository: source control for the frontend and backend.
- Google Apps Script HTML Service: serves the live form and handles server calls.
- Google Sheets: stores verified admission enquiries.
- Interakt: sends WhatsApp Authentication OTP.
- Gmail / Apps Script MailApp: sends Email OTP.

## Files
- `apps-script/Code.gs`: server-side validation, OTP, Interakt API and spreadsheet capture.
- `apps-script/Index.html`: responsive form and OTP interaction.
- `apps-script/SETUP.md`: deployment guide.
- `index.html`: simple repository landing/preview page.

## Form fields
Student name; Class XII (preselected); mode of study; district (Kanyakumari, Tirunelveli, Thoothukudi, Tenkasi, Virudhunagar); school category (Matriculation, CBSE, IGCSE, State Board Government, State Board Government Aided, Other/International); free-text school name; X marks obtained and maximum marks; expected XII marks and maximum marks; merit scholarship interest; mobile and email; WhatsApp or email OTP.

## Live deployment
Follow `apps-script/SETUP.md`. The live form is served from the deployed Google Apps Script Web App URL. GitHub remains the source repository. This avoids cross-origin browser issues and keeps Interakt credentials server-side.

## Security
- OTPs are hashed in Script Properties and expire after five minutes.
- Five incorrect attempts invalidate an OTP.
- Resend cooldown is 60 seconds per destination/channel.
- Form values are bound to the OTP request; changing them requires a new OTP.
- Only verified enquiries are written to the spreadsheet.
- Keep credentials in Apps Script Script Properties, never in this repository.
- Add an institution-approved privacy notice and retention policy before public launch.
