# Deployment and configuration

1. Open the FXEC spreadsheet: https://docs.google.com/spreadsheets/d/12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how/edit
2. Extensions → Apps Script. Paste Code.gs.
3. Project Settings → Script Properties: add SPREADSHEET_ID = 12hy8EV7EaBGJHl2IdL-fc-SFemBCOEoo6MTNNei2how.
4. Deploy → New deployment → Web app. Execute as the spreadsheet owner. Public access is required for public enquiries; confirm institutional approval first.
5. Email OTP is implemented using MailApp. WhatsApp OTP requires the exact Interakt Authentication API endpoint, authentication header and approved template payload. The current sendInteraktOtp function deliberately fails closed until that account-specific adapter is configured and tested.
6. Never put API keys or student data in this GitHub repository. Store credentials only in Apps Script Script Properties.
7. Test expiry, resend cooldown, invalid OTP attempts, successful verification and sheet insertion before launch.

The current index.html is a design/field prototype and is not yet connected to the backend. Do not publish it as a live enquiry form until the client-side verification flow and deployed Apps Script URL are configured and tested.
