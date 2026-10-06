# Happy Sort — backlog

✅ built · 🔨 next · 💡 idea. Patterns marked *(from Unblock-it)* copy how woleywa/Unblock-it is set up.

## Playable game
- ✅ Pour rules, 4-layer bottles, solvable generated levels, mystery `?` layers, undo, extra bottle, coins, saved progress
- ✅ Public website on GitHub Pages (`.github/workflows/pages.yml`)

## 1. Core mechanics from the Magic Sort screenshot (the features promised earlier)
- 🔨 **Frozen bottles**: ice blocks pouring in or out until N pours happened elsewhere (ice count-down, thaw sparks)
- 🔨 **Locked curtain bottles**: red curtain with evil-eye locks; each completed colour removes one lock
- 🔨 **Shuffle power-up** (the middle button): reshuffles the colours that aren't finished
- 🔨 **Coin shop**: spend coins on undo / shuffle / extra bottle (the 19 / 14 / 7 counters)
- 🔨 **Sound + haptics + effects**: pouring stream, glug, win chime, confetti; sound and haptics switches in Settings *(from Unblock-it: audio.js, Native.buzz)*
- 💡 More levels types: bottles with 5–6 slots, bigger boards, time challenges

## 2. Web app / mobile website *(from Unblock-it)*
- 🔨 PWA: `manifest.webmanifest`, icons, service worker with offline play, "Add to Home Screen"
- 🔨 Cache busting: `?v=N` on script/style tags + service-worker cache name bumped on every change
- 🔨 Mobile layout checked from 375×667 to 430×932, iPhone standalone safe areas (`100lvh`)
- 💡 Settings screen: language (English / Deutsch, `i18n.js` + `i18n-de.js`), sound, haptics

## 3. Native apps *(from Unblock-it)*
- 💡 Capacitor 8 wrapper: iOS + Android projects, `capacitor.config.json`, `js/native.js` (status bar, haptics, Android back button)
- 💡 `.github/workflows/apps.yml`: Android debug APK, unsigned iOS .ipa, on every push to main
- 💡 Live updates: publish the web build as a release zip + `update.json`, apps download it in the background (`@capgo/capacitor-updater`)
- 💡 Permanent APK link on a fixed GitHub release
- 💡 App icon + splash from source art, `npm run icons`
- 💡 App Store / Google Play release, TestFlight for friends, privacy page + account deletion (Apple requires it)

## 4. Progress, rewards and fun *(from Unblock-it)*
- 💡 Daily puzzle with 🔥 streak (one freeze a week) and a shareable result
- 💡 Star ratings per level (by number of pours), medals/achievements
- 💡 Themes unlocked with coins/stars (bottle shapes, backgrounds)
- 💡 "New!" pop-up the first time a level uses ice, curtains or mystery layers, with a looping mini demo
- 💡 Level list / map, jump to any unlocked level
- 💡 Colour-blind mode: a symbol on every colour

## 5. Online and social *(from Unblock-it, Firebase)*
- 💡 Anonymous accounts, nickname, cloud save, leaderboard
- 💡 Friends, teams, timed challenges, invites
- 💡 Hosting on Firebase later if a custom domain is wanted

## Housekeeping
- 💡 `CLAUDE.md` with the rules above for future sessions (workflow: push straight to main, bump `?v=N` + cache name)
- 💡 Hint button (solver already exists)
- 💡 Playwright smoke test in CI
