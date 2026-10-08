# What's new in LazyCreatives Uploader

Every version of the app, newest first, in plain words. The section for each
version is copied onto its download page automatically when it is released.

<!--
How to keep this up to date:
- Every change people will notice adds one line to the top section, saying what
  they will see or what now works, not how it was done.
- Put each line under New, Better or Fixed. Leave out headings with nothing under them.
- Until the first release, changes go under 0.1.0 below; on release day replace
  "not out yet" with the date. After that, start an "## Unreleased" section above
  it, and when the version is bumped rename it to "<version> (<day> <month> <year>)".
  The checks on pull requests fail if a new version has no section here.
-->

## 0.2.9 (8 October 2026)

### Better
- **The Genre and Year columns view on Your tracks is redone.** It matches the rest of the app: ratings show on every row and can be set right there, a new Favourites section (Rated) sits above the genres, and each track says Public or Private in words.
- **Settings in tabs.** Settings is split into short tabs: Folders, SoundCloud, New posts, Automatic, Look, Privacy and App, laid out in rows like Backups, and opens on the one you used last. The new Privacy tab says plainly what Uploader reads, how your SoundCloud login is kept and what leaves your computer. On/Off buttons replace tick boxes, Off / Hourly / Daily buttons replace the minutes box, and the wording is plain throughout.

### Fixed
- **The Delete button on Your tracks is back in view.** At the normal window size the row ran past the edge, hiding the bin button when you point at a track.

## 0.2.8 (8 October 2026)

### New
- **Home shows big rolling numbers**: ready to post, posted, plays and failed.
- **Watch it go up.** While a mix uploads, its own waveform fills with colour. When posting finishes, the sloth waves and says how many went up, with a button to open the first one on SoundCloud.
- **Stop a post, and a warning before quitting mid-post.**
- **"Out now" on release day.** A stamp lands on the album's cover on release day and stays there after.

### Better
- **First run asks Light, Dark or Match my computer**, the same choice as in Settings, instead of looks Uploader doesn't have.
- **The Post button says "Tick mixes to post"** until you tick something, then turns SoundCloud orange. New mixes say "New" in the Status column.
- **Your tracks stays quick with thousands of tracks.** Search waits until you stop typing, the Genre › Year columns show 200 at a time, and Rows, Covers and Columns sit at the top with words.
- **Connecting SoundCloud can be cancelled**, or its page opened again, while you sign in.
- **Albums:** rows take the colour of their songs' main genre, crossfade is one line in the album header, and the album list says "ready" once.
- **One calm type scale and square record-pool corners.** Coloured edges only mean genre or what's playing.
- **Search finds mixes named in any script**, and light mode's tick boxes and coloured words are easier to see.
- **Album songs slide out of the way when you drag one.** The others make room as you move it, and the numbers update as you go, so you see the new order before you let go. Turned off if your computer is set to reduce motion.
- **Warnings in plain words.** When something doesn't work, the app now says what went wrong and what to do next, instead of short programmer notes like "no such picture" or a bare number.
- **The page after you sign in to SoundCloud matches the app.** Same look as Uploader, light or dark like your computer, and it names the account you connected.

### Fixed
- **Numbered mixes are separate songs.** "Episode 101" and titles in other languages are no longer taken for another song, held back or marked "posted twice".
- **When SoundCloud signs you out, the app says so** and offers "Sign in again", instead of "SoundCloud had a problem" and a green "connected".
- **A post stops when SoundCloud signs you out or asks us to wait**, and says for how long, instead of sending every mix only to be refused.
- **No double posts after a dropped connection.** "Try again" checks SoundCloud first.
- **Tags like 80's and rock'n'roll come back as you typed them.**
- **Small fixes:** removing your last folder no longer brings back the welcome every launch, Settings › Updates fits mid-size windows, cover tick boxes no longer sit on the catalogue number, Undo on an album puts the song back in its place, and the "Waveform" heading no longer runs into "From project".
- **"Go public later" waits for your date.** A mix set to go public on a later date could go public within a minute of posting. It now stays private until the day and time you picked.
- **Sign-in no longer says "connected" when it wasn't.** If you press Cancel on SoundCloud or the sign-in fails, the page now says so and tells you how to try again.

## 0.2.7 (8 October 2026)

### New
- **Albums: plan what comes out next.** A new Albums page holds each album you're putting together: its songs in order (drag to reorder), the release day with a countdown, and what each song still needs before then, like a WAV, a proper title, or a fresh export after the project changed. Albums are shared with Backups, so a change in one app shows in the other.
- **Hear the whole album, with crossfade.** Play album runs it top to bottom with the songs blending into each other, anywhere from Off to 12 seconds, the way Spotify or Apple Music would play it. Mark songs that should run straight into the next one, and "Play joins only" plays just the seconds around each change. It only changes how the album plays; your files stay exactly as they are.
- **Report a problem in one click.** Help, Report a problem (or the new button at the bottom of Settings) opens a short report on GitHub with your app version and computer type already filled in. You read it before you send it.
- **Crashes offer to report themselves.** If the app runs into an error, its engine stops or it closes suddenly, it says so and offers that same report, with what went wrong filled in. Nothing is ever sent by itself, and no music, files or SoundCloud login are included.
- **Re-export a song and the new version goes up in its place.** It keeps the old upload's title, cover, details and playlist spots. Private songs swap by themselves during the automatic folder check (a Settings switch turns this off); a public song gets an Update button on Upload, since its plays and comments start again. The old upload is never deleted for you: Your tracks marks it "Replaced by a new version" with a Remove button.
- **Pause the music when you minimize.** Tick "Pause the music when the window is minimized" in Settings, under App, and whatever is playing pauses when you minimize the window. Off unless you tick it, and the music waits for you to press play again.

### Better
- **Whole names on the big-type covers.** Covers that print a song's name in big letters now size each word to fit, so "Chrome Hearts" no longer reads "CHROI HEART".
- **One row per song on Upload.** A mix saved as WAV and MP3 (even with slightly different names, like "Heavy master" and "Heavy") shows once, with a small tag for each format. The best one posts; click another tag to post that one instead.
- **Your tracks spots songs posted twice.** Near-identical titles of the same length count as the same song, a line at the top says how many, and the copy with the most plays is the one marked to keep.

### Fixed
- **The level meters keep time with the music.** The two little meters in the player bar now listen to the song as it plays, so they jump with every beat, show left and right separately and fall the moment you pause, instead of drifting out of step.
- **No more doubles on SoundCloud.** A song already up in any format or version, including ones you posted on the SoundCloud website, is no longer ticked as new. Posting it anyway asks you first, and two formats of one song ticked together only post once.
- **Ratings sit in the middle of their column.** On Your tracks, the rating marks and the Rating heading are centred, and all five marks fit.

## 0.2.6 (7 October 2026)

### New
- **Uploader can look in your Backups export folders too.** If you use Backups, one switch under Watched folders also looks in every export folder Backups knows about, so you don't have to add them twice. Off until you turn it on.
- **A cover for automatic posts, if you want one.** Tick "Give automatic posts a waveform cover" in Settings and songs posted by the folder check or as drafts get a cover drawn from the song, in your waveform colour. Off unless you tick it.
- **New posts can go into a playlist by themselves.** In Settings, pick one of your playlists, or "A playlist for each genre", and every song you post is added to it. Off until you pick one; nothing is ever taken out of a playlist.

### Better
- **Stems stay out of your way.** The separate parts of a song — a kick, the vocals, Ableton's "Song 3-Bass", anything in a Stems folder — are no longer listed for posting, never ticked for you and never posted by the automatic folder check. A "Show stems" box on Upload brings them back when you do want one.

### Fixed
- **No more keychain password prompts on Mac.** Uploader no longer asks your Mac's keychain for anything, so the repeated "wants to use your confidential information" boxes are gone. Your SoundCloud login is still encrypted, with its key in a file only your user account can open. After this update on a Mac, connect SoundCloud once more in Settings.

## 0.2.5 (7 October 2026)

### New
- **Edit a playlist's details.** An Edit details button on each playlist page changes its name, description, genre, tags, privacy and cover on SoundCloud. The songs in it stay as they are.

### Better
- **A song opened from a playlist stays on the playlist.** Its panel opens over the playlist page, and closing it leaves you on the playlist instead of Your tracks.

## 0.2.4 (7 October 2026)

### Better
- **Clearer words about what Uploader does for you.** The welcome screen, the empty Home page and a new "What it does" box in Settings now say plainly which jobs it takes off your hands.
- **Open a song from a playlist.** Click a song on a playlist's page (or press Enter on it) to go to that song's page, the same as on Your tracks. Its drag handle, play button and ✕ still do their own jobs.

### Fixed
- **Playlists count their private songs.** A playlist with private songs in it no longer says it holds fewer tracks than it does (e.g. "5 tracks" for nine).

## 0.2.3 (7 October 2026)

### Fixed
- **Move the window on Windows again.** The strip along the top of the window is back, so you can drag the window around by it and double-click it to make the window bigger. The ☰ button on its left opens the menus.

## 0.2.2 (7 October 2026)

### New
- **Change a title before posting.** Pick Edit title… on a mix's ⋯ button (or double-click its name) on Upload, or click a title on the last look before posting, and type what it should be called on SoundCloud. Your file keeps its name.
- **Try again from History.** A failed post now has a Try again button (also on right-click) that posts it again with the same title and privacy. It only shows while that file hasn't gone up since.

### Better
- **A calmer, simpler look.** The Uploader now has one look, rows with waveforms, and the Crate/Sleeve switch is gone; on Your tracks, the new Covers button shows your tracks as album covers. Every screen shows less at once: posting choices sit under Post settings, filters under Filters, and mixes already on SoundCloud fold away. Upload ticks only mixes exported since your last post and shows when each was exported, newest first. Failed posts stand out in History, Home fits on one screen, and your collection figures moved to Your tracks. Row spacing and Preview on hover moved to Settings, under Lists. Change cover is now on each mix's ⋯ button, and "Show short files" is under Post settings.

### Fixed
- **Adding to a playlist works again.** Add to playlist stopped working after SoundCloud changed how apps must name tracks; it now adds the track and keeps everything already in the playlist, public or private.

## 0.2.1 (7 October 2026)

### New
- **Recently opened.** The last five tracks you opened sit in the sidebar under the menu, newest first, so you can jump back in with one click; Find anything (Ctrl+K / Cmd+K) lists them before you type. Right-click to take one off or clear the list. Kept on this computer only.
- **A bigger player.** Point at the cover in the player along the bottom and press the up arrow (or click the cover) to open a large Now playing view with a big cover, the waveform to scrub and the play button. The down arrow or Escape shrinks it back.
- **Your own cover art.** In Settings, under Covers, save as many pictures as you like and use each one behind the drawn cover or as the whole cover. Give pictures to genres, mix them across your mixes, or use one for everything, and pick Ink print, Photo or Label strip for how a picture sits behind the drawing. Your old default cover moves in here by itself.
- **Playlists.** A new Playlists page shows your SoundCloud playlists. Make one, add tracks (tick them in Your tracks and press Add to playlist, or add them from the playlist's own page), drag them into order and take them out. Every change goes to SoundCloud straight away.
- **Change cover** on any mix (right-click it, or Cover on its row) picks the drawn cover, any saved picture or a new one, with its own style. A cover picked in Backups shows here too.
- **Short exports stay out of the way.** Clicks, test bounces and one-shot renders shorter than 30 seconds are hidden on the Upload page and never posted automatically. Change the length or turn it off in Settings, under Watched folders; "Show short files" on Upload brings them back, and nothing is deleted.

### Better
- **Click a track's name in the player** to open that track's page.
- **Every mix goes up with the cover you see** on the Upload page, so nothing lands on SoundCloud as a grey square.

### Fixed
- **Automatic posting sends each song once.** When a song was exported as both WAV and MP3, the automatic folder check posted both. Now it posts only the best file of each song, and never a song already on SoundCloud in another format.
- **Mixes no longer post twice.** If the automatic folder check started while you pressed Post (or Post was pressed twice), every mix could go up two times. Now each mix is checked again right before it is sent, so it can only ever be posted once. And if SoundCloud takes a mix but its answer gets lost, the app now finds the track instead of calling it failed, so Try again doesn't post it a second time.
- **Nearly every audio file now plays** in the player: AIFF, Apple Lossless, WMA, AC-3, WavPack, CAF, 64-bit and compressed WAVs and more, where you used to see "Couldn't play this file". Your files are only read, never changed or copied.

## 0.2.0 (6 October 2026)

### New
- **Light mode.** Pick Dark, Light or Match my computer in Settings, under Look; both looks come in paper-light too.
- **A narrow window** that sits beside your music program: drop a mix on it to post it, watch it go up and see your latest posts, always on top if you like (View > Narrow window, or Ctrl+Shift+N / Cmd+Shift+N).
- **Right-click menus.** Right-click a post on Home to open it on SoundCloud, copy its link or see it in History. Text boxes get Cut, Copy, Paste and spelling fixes.
- **Point at the waveform** in the player to see the time, and drag to scrub through the mix.
- **Glass sidebar** on a Mac (frosted) and Windows 11 (tinted by your wallpaper). Older Windows and Linux stay solid.
- **Ctrl+1, 2, 3… (Cmd on a Mac)** jump to that page in the sidebar.
- **Rate your tracks** with one to five marks in Your tracks and from the right-click menu. Pick flames, hearts, records or dots in Settings, and sort by rating.
- **Crate colours.** Give any genre your own colour by right-clicking a track; every stripe and cover of that genre follows it.
- **Row height** in the Crate look's Your tracks and History: compact, comfortable or tall, remembered for next time.
- **History in Sleeve is your back catalogue:** every post as its cover, a shelf per month.
- **Smart crates.** Save any search and filters in Your tracks as a smart crate and show it again in one click.
- **Find anything with Ctrl+K (Cmd+K on a Mac)**, or the box under the app name: jump to a page, track, genre or smart crate, or post a mix, switch look and more.
- **Browse by Genre, then Year, then Track** in the Crate look's Your tracks (the columns button). In the Sleeve look the same choices sit over the covers as chips.
- **Your collection** at the bottom of Home: your tracks in figures, by genre and year, and your most played. In the Sleeve look it reads like a record's liner notes.
- **Filter by year posted and by rating** in Your tracks.
- **Preview on hover.** Switch it on in Upload or Your tracks, then point at a mix to hear a few seconds of it. Up and Down move through the list.
- **Comments on the waveform.** A track's page shows its SoundCloud comments as dots where listeners left them, with the newest three underneath, plus its plays and length.
- **A checklist before posting.** The last look now checks each mix's title, cover, genre, tags, file type and loudness, and says what is worth fixing first. Nothing stops you posting.
- **A bigger track page in the Sleeve look:** a large cover with the plays, length and comments printed big.

### Better
- **Calmer pop-up notes.** Up to three stack up instead of replacing each other, pointing at them holds them, and Home's numbers roll to their new value.
- **Smoother, quicker movement** across the app, and hover effects only with a mouse.
- **Long lists and big numbers fit.** Smaller windows drop the least needed columns instead of cutting off the right side, sizes go up to TB, a 4-hour set reads 4:02:03, BPM is rounded, numbers read 123,456 and "1 play" is singular.
- **A last look before posting.** Before several mixes (or anything public) go up, a short summary shows what will be posted, as Public or Private, and on which account.
- **Stop after this mix.** A running upload can now be stopped; the mix going up finishes and the rest wait.
- **Asks before throwing things away.** Disconnecting SoundCloud asks first and keeps you on Settings, removing a template can be undone, and closing Bulk edit with changes asks first.
- **Clearer lines between rows** in every list, in both looks, and dark, readable text on the orange SoundCloud button.
- **Same words everywhere.** "Draft" instead of "work in progress", the same Home labels in both looks, and the Upload list lines up with Your tracks (file type shown as a small tag).
- **Plainer headings, easier keyboard use, smoother long lists**, and dates that follow your computer's settings.
- **Home in Crate reads like a deck:** one big number for what's posted, with failed, waiting, ready and auto-upload listed underneath, next to your latest uploads.
- **Calmer covers.** Pointing at a cover slides it aside so its record peeks out, covers deal in once per session, and the glow behind Sleeve Home is gone.
- **Pop-ups and the edit panel fade out** when they close instead of vanishing in one frame.

### Fixed
- **The last look before posting sits in the middle again** in the Sleeve look; it had slipped down and could run off the bottom of the window.
- **A failed post's note shows a warning mark**, not a green tick.
- **Posting by hand now uses your default.** "Post as" starts on the default release you picked in Settings (it always started on Public), and your default tags are kept alongside the BPM tag.
- **"Go public later" can't post too early.** Ticking it fills in tomorrow at the same hour, an empty or past time stops the post, and the Post button says when the mixes go public.
- **Tags in Settings** can be typed normally again; commas and spaces no longer vanish.

## 0.1.4 (6 October 2026)

### Better
- **Easier Upload page.** A search box finds a mix by name, project or genre; a box in the Crate heading (or "Tick all" in Sleeve) ticks or unticks every new mix; mixes already on SoundCloud move under their own "Already on SoundCloud" heading and no longer offer "Mark draft". Both looks.
- **History by day.** Posts are grouped under Today, Yesterday and earlier days, with a search box, Posted/Failed/Skipped buttons with counts, and "Show older posts" once you have more than 100.
- **Better Edit track panel.** The track's cover, name and a play button head the panel, tags are separate chips you add with Enter and remove with a click, genre suggests the usual genres as you type, Ctrl+S (Cmd+S) saves, and closing with unsaved changes asks first.
- **Same words and times as Backups.** Music apps are called by their full names, times follow your computer's clock and say Today or Yesterday, and project details on Your tracks wrap onto a second line instead of being cut off.
- **A tidier top on Windows.** The white Windows title bar and the File / Edit / View menu row are gone; the app's own dark colour now runs right to the top, with Windows' minimise, maximise and close buttons on the right. The ☰ button at the top left opens the old menus. Dragging, snapping and double-click to maximise work as before. Both looks; Mac and Linux are unchanged.

## 0.1.3 (5 October 2026)

### New
- **Correct a mix's genre.** Genres you fix in Backups now show here too. To give one mix its own genre (say, a remix), right-click it on the Upload page or click its genre. Guessed genres have a dotted underline; ones you set don't. Works in both looks.
- **Your own genres.** Genres you type yourself stay at the top of the genre list.
- **Find any track on Your tracks.** The search box forgives typos and half-typed words and also looks at project names and music apps. New pickers narrow the list by music app, genre, tempo, project and search score, only offering what your own tracks have. The Public and Private buttons show how many tracks each would show, "Showing 2 of 8 tracks" has a Clear all button, and in the Crate look clicking a column heading sorts by it.

### Better
- **Follows songs renamed in Backups.** When you tidy a song's names in Backups, Uploader still knows which project each mix came from, still plays and outlines it, and still knows it's already on SoundCloud.
- **Matches mixes to projects more often.** Dates, tempo and key in a mix's name ("2026-10-01 Night Drive 124bpm Amin") no longer stop Uploader finding its project, the same way Backups now reads them.
- **Calmer screens in the Crate look.** The coloured stripe is kept for genres only: menus, pop-ups, the welcome box and the update panel no longer have a blue edge.
- **Sloth drawings that move.** "Nothing posted yet" now shows a sleepy sloth napping on a branch, and a search on Your tracks that finds nothing shows a sloth peering through a magnifying glass. Both sit still if you turn animations off in your computer's settings. Works in both looks.
- **A look of its own.** A new sturdy font and deep ink colours, covers made like printed record sleeves (the same as in Backups), level meters that move while a mix plays, slightly bigger small text, long project names that wrap instead of being cut off, and the sloth now says a word when a page is empty.

### Fixed
- **Signing in to SoundCloud on work or college networks.** Sign-in no longer fails with a "certificate verify failed" message on networks that check secure traffic; Uploader now trusts the same certificates as your computer.
- **Bitwig recordings stay out of your mixes.** Audio inside a Bitwig project folder (its samples, recordings and bounced clips) is no longer listed as a mix to upload; songs you export from Bitwig still are.

## 0.1.2 (5 October 2026)

### New
- **Right-click menus.** Right-click a track or mix for its everyday actions in one place: open it on SoundCloud, copy its link, edit it, make it public or private, show the file, or delete it. Works in both looks.
- **Keyboard shortcuts.** Cmd + F (Ctrl + F on Windows and Linux) jumps to the search box, Cmd + , (Ctrl + ,) opens Settings, Space plays or pauses the song in the player, and Esc closes the open panel. Help, Keyboard shortcuts lists them all.
- **A proper menu bar.** File, Edit, View, Window and Help menus, with the shortcuts listed next to each item, What's new, the website and Report a problem.
- **Drag and drop.** Drop a folder of mixes (or a mix) onto the window to add it to the folders Uploader watches.
- **Copy buttons.** One click copies a watched folder's path, or a track's SoundCloud link from its Edit panel.
- **Progress on the app icon.** While an upload runs, the dock (Mac) or taskbar (Windows) icon fills up to show how far it has got.

### Better
- **Settings save themselves.** Every change in Settings is saved straight away and a small "Saved" appears; there is no Save button to forget.
- **"Are you sure?" boxes that match the app.** Deleting a track from SoundCloud, or changing many at once, now asks in a box in the app's own look instead of the computer's grey pop-up.
- **Undo.** Removing a watched folder shows a short message with an Undo button.
- **Picks up where you left off.** The app reopens at the same size and place on screen, on the page you closed it on, with your sort order and filters as you left them.
- **Tray menu.** The tray / menu bar icon now reads "Open LazyCreatives Uploader" and "Quit LazyCreatives Uploader", the same in both apps.
- **See how each mix is doing while you post.** On the Upload page every mix shows Waiting, Uploading with its own bar, Posted, or Skipped (already on SoundCloud). Works in both looks.
- **A failed mix says why.** It shows the reason in red and a Try again button that posts just that mix. It stays ticked, so the next Post includes it.
- **Home tells you what's waiting.** When there are new mixes in your folder, Home says how many are ready to post and which one you exported last, with a Review and post button.
- **A friendlier welcome.** First-time setup now lets you pick your look straight away, and it now describes the steps in the order you do them: your folder first, then your SoundCloud account.
- **Friendlier empty pages.** When a list is empty or something goes wrong, the sloth shows up with a short line and a button for the next step.
- **Smoother and rounder.** Pages glide in, dropdowns match the app's look, covers settle into place one after another, and the Sleeve look has softer corners.

### Fixed
- **Logic Pro recordings stay out of your mixes.** If a watched folder holds Logic projects, the recordings inside them are no longer listed as mixes; your bounces still are.
- **Track names show at the normal window size.** On Your tracks, Upload and History the name column no longer shrinks to nothing when the window isn't very wide.
- **The tick box on a mix's cover no longer covers its catalogue number.** In the cover look on the Upload page it now sits in the top-left corner.

## 0.1.1 (5 October 2026)

### New
- **Back and forward with your mouse's side buttons.** The extra buttons on the side of a mouse now go back to the last page and forward again, like a web browser. On the keyboard it's Alt + left/right arrow on Windows and Linux, and Cmd + [ or ] on a Mac. Nothing happens while you're typing in a box.
- **Your tracks remembers where you were.** Go to another page and come back, or close a track's details, and the list is on the same page and scrolled to the same spot with the same search, filters and sort. The track you had open lights up for a moment. Works in both looks.

### Better
- **Runs on a newer app engine** with the latest security and speed fixes. Everything looks and works the same, and file pickers still open in the folder you last used. On a Mac it needs macOS 13 (Ventura) or newer.

### Fixed
- **The app icon now shows the Lazy Creatives logo** (the sloth, with a small upload arrow) in the installer, the Dock, the taskbar and the menu bar, instead of the old shield.

## 0.1.0 (4 October 2026)

### New
- **Post your mixes to SoundCloud without ever posting the same one twice.** The app knows what's already up, even when the same mix is saved in another format.
- **Your tracks**: edit, hide or delete the tracks already on your SoundCloud from one place.
- **Knows where each song came from.** If you use LazyCreatives Backups, each mix shows the project it was exported from, with its tempo and genre filled in.
- **Cover art made for you** from the song's sound, with lettering that looks the same on every computer.
- **Two looks, your choice**, the same as Backups: **Crate** (DJ-library rows with genre stripes and waveforms) or **Sleeve** (cover cards). A song has the same cover in both apps.
- **Play your mixes in the app** from a player bar at the bottom.
- **Check for updates yourself.** Settings shows which version you have and a **Check for updates** button that tells you straight away whether a newer one is out.
- **The app updates itself.** On Windows and Linux new versions download quietly and offer "Restart now" or "Later". On a Mac the app tells you a new version is out and takes you to the download page.
- **See what's new after an update.** The update message lists what changed in the new version, and the first time the app opens after updating it shows a short "What's new" list. Open it again any time from **What's new** in Settings.
- The update button says **Restart the app**, and the message makes clear that only the app restarts, never your computer.
- **Everything is unlocked** while the app is a free beta.
- Installers for Windows, Mac (Apple silicon) and Linux.

### Better
- Your SoundCloud login is locked away safely on Mac and Linux too, not just Windows.
