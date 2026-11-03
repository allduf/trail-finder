# Account emails: codes and our own sender (alex, 2026-11-03)

Two one-time steps in the Supabase dashboard (project fohdmserpbkurcvcrbbb). Nothing here needs code.

## 1. Put the code in the emails (needed for "Sign in with the code")

Authentication → Emails → Templates. In **Magic Link** and in **Confirm signup**, add this line above the link:

    <p>Your Trail Finder code: <strong>{{ .Token }}</strong></p>

Save each one. The link stays, so the website still works by tapping it; the iPhone app uses the code.

## 2. Our own email sender (Brevo, free, 300 emails a day)

Supabase's own sender only allows a few emails an hour. Brevo is free and works without owning a web domain.

1. Make a free account at brevo.com.
2. Senders, Domains & Dedicated IPs → Senders → Add a sender: name "Trail Finder", email trailfinder.help@outlook.com. Brevo emails that address a link; tap it.
3. SMTP & API → SMTP tab: copy the **Login** and click **Generate a new SMTP key**, copy the key.
4. Supabase: Authentication → Emails → SMTP Settings → Enable custom SMTP:
   - Sender email: trailfinder.help@outlook.com, Sender name: Trail Finder
   - Host: smtp-relay.brevo.com, Port: 587
   - Username: the Brevo Login, Password: the SMTP key
5. Authentication → Rate Limits: set "Rate limit for sending emails" to 100 per hour.
6. Test: sign out, tap "Forgot password? Email me a code" with your own email.

Later, a web domain of our own (about $15 a year) would make the emails less likely to land in spam.
