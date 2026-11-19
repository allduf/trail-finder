# Trail Finder for Android

The Android app is the live website (https://trailfinderapp.ca) in a Capacitor shell, exactly like the iPhone app in
`ios-app/`. Website changes reach it without a new build. A new build is only needed when `android-app/` changes.

- `capacitor.config.json`: same app id (`com.allduf.trailfinder`), name, colours and live address as the iPhone app.
- `plugins/TrailGps/`: the app's own GPS, the same calls as the iPhone's (`ios-app/plugins/TrailGps`):
  rides keep recording with the screen off (a foreground service with a notification), the fixes missed while the
  page slept come back, spoken directions over the music, a planned ride's turns said with the screen off, live
  location every 20 s, and the notification shows the ride (km, climb, trail, or next turn, km left, arrival) where the
  iPhone uses the lock screen.
- `android/app/.../MainActivity.java`: photo boxes offer the camera next to the gallery, like the iPhone.
- On the website, `native.js` adds the Android Back button (closes what's open, then puts the app away) and
  readable status bar icons on both themes; `app-update.js` (TestFlight popup) and `usage.js` (iPhone-only usage
  page) stay off on Android.

Not in the Android app yet: phone notifications (they need a Firebase project and the push job sending to it),
and the iPhone-only "Native map (test)".

## Builds

`.github/workflows/android-app.yml`:
- pull requests: a test build on an Android 14 phone simulator, with the pull request's own website, checked by
  `test/phone-check.mjs` (screenshots in the `android-phone-check` artifact);
- main / Run workflow: the Google Play build (`android-play-build`, an .aab), a test .apk that installs on any
  Android phone (`android-test-apk`), and, once the Play key is set, sent to Play's Internal testing by itself.
  The build number is the workflow's run number.

## Repository secrets

Settings > Secrets and variables > Actions > New repository secret:

| Name | What |
| --- | --- |
| `ANDROID_UPLOAD_KEY` | the upload key, as one long line of text |
| `ANDROID_KEY_PASSWORD` | its password |
| `PLAY_SERVICE_ACCOUNT_JSON` | later: a Google Play service account key (the whole .json text), so builds go to Play by themselves |

The upload key only proves a build comes from us. Google keeps the real app signing key (Play App Signing), so if
the upload key is ever lost, Play Console > Test and release > App integrity > "Request upload key reset" replaces it.
Never put the key or password in the repository.
