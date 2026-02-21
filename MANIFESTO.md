v7 web interface should have a Practice Game subpage (/practice). The subpage must be mobile friendly, but it requires the use of an external keyboard. So **do not implement an on-screen keyboard**.

There are several practice modes:
* Partial syllable, left hand
* Partial syllable, right hand
* Partial syllable, random hand
* Full syllable

The list of syllables should be taken from generated_regexes.json. Do a regex enumeration to get the list of all syllables.

For all practice modes:
* A random syllable is chosen, 
