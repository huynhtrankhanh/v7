v7 web interface should have a Practice Game subpage (/practice). The subpage must be mobile friendly, but it requires the use of an external keyboard. So **do not implement an on-screen keyboard**.

There are several practice modes:
* Partial syllable, left hand
* Partial syllable, right hand
* Partial syllable, random hand
* Full syllable

The list of syllables should be taken from generated_regexes.json. Do a regex enumeration to get the list of all syllables.

For all practice modes:
* A random syllable is chosen
* The user hits the chord for the syllable on the keyboard
* If the chord is wrong, the user has to try again until they get the chord right
* *For how chords correspond to each syllable, read README_WEB.md and also the frontend script files.*
* **Partial syllable: while standard v7 is two handed, in this game only one hand is used because there is only one syllable. The * (spacebar) key always has to be held for a chord to be valid.**
* Each game lasts 60 seconds
* There is a leaderboard for each practice mode in localStorage
